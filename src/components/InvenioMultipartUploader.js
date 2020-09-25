import { QUploaderBase } from 'quasar'
import { Component } from 'vue-property-decorator'
import { mixins } from 'vue-class-component'

function getFn (prop) {
  return typeof prop === 'function'
    ? prop
    : () => prop
}

export default @Component({
  name: 'InvenioMultipartUploader',
  props: {
    url: [Function, String],
    headers: [Function, Array],
    batch: [Function, Boolean],
    partSize: {
      type: [Function, Number],
      default: 10485760 // 10 MB
    },
    maxParts: {
      type: [Function, Number],
      default: 10000 // Default Invenio-Files-REST value
    },
    factory: Function
  }
})
class InvenioMultipartUploader extends mixins(QUploaderBase) {
  xhrs = []
  promises = []
  workingThreads = 0
  chunkQueue = []
  uploadedChunks = []

  get xhrProps () {
    return {
      url: getFn(this.url),
      method: getFn(this.method),
      headers: getFn(this.headers),
      batch: getFn(this.batch),
      partSize: getFn(this.partSize),
      maxParts: getFn(this.maxParts)
    }
  }

  __getProp (factory, name, arg) {
    return factory[name] !== undefined
      ? getFn(factory[name])(arg)
      : this.xhrProps[name](arg)
  }

  // [REQUIRED]
  // we're working on uploading files
  get isUploading () {
    return this.workingThreads > 0
  }

  // [optional]
  // shows overlay on top of the
  // uploader signaling it's waiting
  // on something (blocks all controls)
  get isBusy () {
    return this.promises.length > 0
  }

  // [REQUIRED]
  // abort and clean up any process
  // that is in progress
  abort () {
    console.warn('multipart-upload aborting')
    this.xhrs.forEach(x => {
      x.abort()
    })

    if (this.promises.length > 0) {
      this.abortPromises = true
    }
  }

  // [REQUIRED]
  upload () {
    console.debug('multipart-upload starting')
    if (this.canUpload === false) {
      return
    }

    const queue = this.queuedFiles.slice(0)
    if (queue.length === 0) {
      return
    }
    this.queuedFiles = []

    const file = queue[0]
    this.__runFactory(file)
  }

  __runFactory (file) {
    this.workingThreads++
    if (typeof this.factory !== 'function') {
      this.__multipartUpload(file, {})
      return
    }

    const res = this.factory(file)

    if (!res) {
      this.$emit(
        'factory-failed',
        new Error('InvenioMultipartUploader: factory() does not return properly'),
        file
      )
      this.workingThreads--
    } else if (typeof res.catch === 'function' && typeof res.then === 'function') {
      this.promises.push(res)

      const failed = err => {
        if (this._isBeingDestroyed !== true && this._isDestroyed !== true) {
          this.promises = this.promises.filter(p => p !== res)

          if (this.promises.length === 0) {
            this.abortPromises = false
          }

          this.queuedFiles = this.queuedFiles.concat(file)
          this.__updateFile(file, 'failed')

          this.$emit('factory-failed', err, file)
          this.workingThreads--
        }
      }

      res.then(factory => {
        if (this.abortPromises === true) {
          failed(new Error('Aborted'))
        } else if (this._isBeingDestroyed !== true && this._isDestroyed !== true) {
          this.__multipartUpload(file, factory)
          this.promises = this.promises.filter(p => p !== res)
          return factory
        }
      }).catch(failed)
    } else {
      this.__multipartUpload(file, res || {})
    }
  }

  __multipartUpload (file, factory) {
    const xhr = new XMLHttpRequest()
    let url = this.__getProp(factory, 'url', file)

    if (!url) {
      this.workingThreads--
      return
    }

    let partSize = this.__getProp(factory, 'partSize')
    const
      size = file.size,
      maxParts = this.__getProp(factory, 'maxParts')

    if (size < partSize) {
      this.workingThreads++
      this.__uploadFile(file, factory)
    } else if (Math.ceil(size / partSize) > maxParts) {
      // Compute part size to satisfy maxParts limit
      partSize = size / maxParts
    }

    console.debug('multipart-upload initializing', url)

    const params = new URLSearchParams([['size', size], ['partSize', partSize]]).toString()
    url = `${url}?uploads&${params}`

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) {
        return
      }

      if (xhr.status && xhr.status === 200) {
        const response = JSON.parse(xhr.responseText)
        this.$emit('multipart-started', {
          file,
          xhr,
          response
        })
        this.__uploadParts(factory, file, response)
      } else {
        this.$emit('failed', {
          file,
          xhr
        })
      }
      this.workingThreads--
      this.xhrs = this.xhrs.filter(x => x !== xhr)
    }
    xhr.open('POST', url)

    const headers = this.__getProp(factory, 'headers', file)
    headers && headers.forEach(head => {
      xhr.setRequestHeader(head.name, head.value)
    })

    this.xhrs.push(xhr)
    xhr.send(null)
  }

  __uploadParts (factory, file, multipartUpload) {
    // eslint-disable-next-line camelcase
    const { part_size, last_part_number, last_part_size } = multipartUpload
    // eslint-disable-next-line camelcase
    this.chunkQueue = new Array(last_part_number + 1)
      .fill()
      .map((_, index) => index)
      .reverse()
    this.uploadedChunks = []

    // eslint-disable-next-line camelcase
    for (let i = 0; i < last_part_number + 1; i++) {
      this.__uploadPart(
        factory,
        file,
        multipartUpload.links.self,
        part_size,
        last_part_size,
        last_part_number
      )
    }
  }

  __uploadPart (factory, file, url, partSize, lastPartSize, lastPartId) {
    if (!this.chunkQueue.length) {
      console.warn('all parts already uploaded')
      return
    }

    if (!url) {
      console.error('missing chunk upload url')
      return
    }
    this.workingThreads++

    const chunkId = this.chunkQueue.pop()

    partSize = chunkId === lastPartId ? lastPartSize : partSize

    const
      xhr = new XMLHttpRequest(),
      begin = chunkId * partSize,
      chunk = file.slice(begin, begin + partSize),
      params = new URLSearchParams([['partNumber', chunkId]]).toString(),
      numParts = lastPartId + 1,
      headers = this.__getProp(factory, 'headers', file)

    const partUrl = `${url}&${params}`

    xhr.open('PUT', partUrl)

    headers && headers.forEach(head => {
      xhr.setRequestHeader(head.name, head.value)
    })

    xhr.onreadystatechange = () => {
      if (xhr.readyState < 4) {
        return
      }
      if (xhr.readyState === 4 && xhr.status === 200) {
        this.uploadedChunks.push(chunkId)
        console.debug('chunk uploaded', chunkId, this.uploadedChunks)

        if (this.uploadedChunks.length === numParts) {
          this.__finishMultipartUpload(file, url, numParts)
        }
      } else {
        console.warn('part upload failed', chunkId)
        this.chunkQueue.push(chunkId)
      }
      this.workingThreads--
      this.xhrs = this.xhrs.filter(x => x !== xhr)
    }

    console.debug('part upload starting', chunkId, chunk)

    this.xhrs.push(xhr)
    xhr.send(chunk)
  }

  __fileUploaded (file, args) {
    this.uploadedFiles = this.uploadedFiles.concat(file)
    this.__updateFile(file, 'uploaded')
    this.$emit('uploaded', args)
  }

  __fileUploadFailed (file, args) {
    this.queuedFiles = this.queuedFiles.concat(file)
    this.__updateFile(file, 'failed')
    this.$emit('failed', args)
  }

  __finishMultipartUpload (file, uploadUrl, numParts) {
    console.debug('finishing multipart upload')
    // TODO: get & check current multipart status from uploadUrl
    this.workingThreads++

    fetch(uploadUrl)
      .then(result => result.json())
      .then(response => {
        if (response.parts.length === numParts && !response.completed) {
          fetch(uploadUrl, { method: 'POST' })
            .then(result => result.json())
            .then(response => {
              if (response.completed) {
                this.__fileUploaded(file, { file })
              } else {
                this.__fileUploadFailed(file, { file })
              }
            })
        } else {
          console.error('multipart upload failed', response)
          this.__fileUploadFailed(file, { file })
        }
      })
      .finally(() => this.workingThreads--)
  }

  __uploadFile (file, factory) {
    const
      xhr = new XMLHttpRequest(),
      url = this.__getProp(factory, 'url', file)

    if (!url) {
      this.workingThreads--
      return
    }

    let
      uploadIndexSize = 0,
      uploadedSize = 0,
      maxUploadSize = 0,
      aborted

    xhr.upload.addEventListener('progress', e => {
      if (aborted === true) {
        return
      }

      const loaded = Math.min(maxUploadSize, e.loaded)

      this.uploadedSize += loaded - uploadedSize
      uploadedSize = loaded

      let size = uploadedSize - uploadIndexSize
      const
        uploaded = size > file.size

      if (uploaded) {
        size -= file.size
        uploadIndexSize += file.size
        this.__updateFile(file, 'uploading', file.size)
      } else {
        this.__updateFile(file, 'uploading', size)
      }
    }, false)

    xhr.onreadystatechange = () => {
      if (xhr.readyState < 4) {
        return
      }

      if (xhr.status && xhr.status < 400) {
        this.__fileUploaded(file, { file, xhr })
      } else {
        aborted = true
        this.uploadedSize -= uploadedSize
        this.__fileUploadFailed(file, { file, xhr })
      }

      this.workingThreads--
      this.xhrs = this.xhrs.filter(x => x !== xhr)
    }

    xhr.open(
      this.__getProp(factory, 'method', file),
      url
    )

    const headers = this.__getProp(factory, 'headers', file)
    headers && headers.forEach(head => {
      xhr.setRequestHeader(head.name, head.value)
    })

    this.__updateFile(file, 'uploading', 0)
    file.xhr = xhr
    file.__abort = () => {
      xhr.abort()
    }
    maxUploadSize += file.size

    this.$emit('uploading', {
      file,
      xhr
    })
    this.xhrs.push(xhr)
    xhr.send(new Blob([file]))
  }
}
