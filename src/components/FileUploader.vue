<template lang="pug">
invenio-multipart-uploader.uploader.bg-grey-2(
  :factory="getUrl"
  ref="uploader"
  :headers="[ { name: 'Access-Control-Allow-Origin', value: 'http://localhost:8080'} ]"
  flat
  square
  text-color="grey-9"
  color="grey-4"
  editable=true
  multiple=false
  send-raw
  method="PUT"
  no-thumbnails
  @added="fileAdded"
  @uploaded="fileUploaded"
  @start="fileUploading")
</template>

<script>
import InvenioMultipartUploader from 'components/InvenioMultipartUploader'
import { Component, Emit, Vue } from 'vue-property-decorator'

export default @Component({
  name: 'FileUploader',
  props: {
    uploadUrl: String,
    accept: String
  },
  components: {
    InvenioMultipartUploader
  }
})
class FileUploader extends Vue {
  file = ''

  fileAdded (files) {
    if (files.length > 0) {
      this.file = files[0].name
    }
  }

  getUrl (file) {
    return {
      url: `${this.uploadUrl}/${file.name}`,
      method: 'PUT'
    }
  }

  @Emit('fileUploading')
  fileUploading () { }

  @Emit('fileUploaded')
  fileUploaded () { }
}
</script>

<style lang="sass" scoped>
.uploader
  min-height: 400px
</style>
