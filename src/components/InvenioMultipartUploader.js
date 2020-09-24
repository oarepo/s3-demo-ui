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

  getProp (factory, name, arg) {
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

    this.workingThreads++

    const file = queue[0]
    const fact = this.__runFactory(file)

    this.__initMultipartUpload(file, fact)
    this.__uploadFile(file, fact)
  }

  __runFactory (file) {
    if (typeof this.factory !== 'function') {
      return
    }

    const res = this.factory(file)

    if (!res) {
      this.$emit(
        'factory-failed',
        new Error('QUploader: factory() does not return properly'),
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
          this.promises = this.promises.filter(p => p !== res)
          return factory
        }
      }).catch(failed)
    } else {
      return res || {}
    }
  }

  __initMultipartUpload (file, factory) {
    // const xhr = new XMLHttpRequest(),
    const url = this.getProp(factory, 'url', file)

    console.debug('multipart-upload initialize', url)

    if (!url) {
      this.workingThreads--
      return
    }

    const
      size = file.size,
      maxParts = this.getProp(factory, 'maxParts')

    let partSize = this.getProp(factory, 'partSize')

    if (size < partSize) {
      // No need for multipart upload
      return
    } else if (Math.ceil(size / partSize) > maxParts) {
      // Compute part size to satisfy maxParts limit
      partSize = size / maxParts
    }

    const params = new URLSearchParams([['size', size], ['partSize', partSize]]).toString()

    console.debug('POST to ', `${url}?uploads&${params}`)
    // xhr.open('POST', url)
  }

  __uploadFile (file, factory) {
    const
      xhr = new XMLHttpRequest(),
      url = this.getProp(factory, 'url', file)

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
        // this.__updateFile(file, 'uploading', file.size)
      } else {
        // this.__updateFile(file, 'uploading', size)
      }
    }, false)

    xhr.onreadystatechange = () => {
      if (xhr.readyState < 4) {
        return
      }

      if (xhr.status && xhr.status < 400) {
        this.uploadedFiles = this.uploadedFiles.concat(file)
        // TODO:
        // this.__updateFile(file, 'uploaded')
        this.$emit('uploaded', {
          file,
          xhr
        })
      } else {
        aborted = true
        this.uploadedSize -= uploadedSize
        this.queuedFiles = this.queuedFiles.concat(file)
        this.__updateFile(file, 'failed')
        this.$emit('failed', {
          file,
          xhr
        })
      }

      this.workingThreads--
      this.xhrs = this.xhrs.filter(x => x !== xhr)
    }

    xhr.open(
      this.getProp(factory, 'method', file),
      url
    )

    const headers = this.getProp(factory, 'headers', file)
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

    xhr.send(new Blob(file))
  }
}
