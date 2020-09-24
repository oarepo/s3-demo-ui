<template lang="pug">
q-page.column.justify-center
  .col-auto.row.justify-center
    q-card.col-10
      q-card-section.bg-primary.text-white
        h3 Upload files to S3
        .text-subtitle1 Bucket ID {{ s3Bucket }}
      q-card-section.no-padding
        file-uploader.full-height.full-width.no-padding(
          :upload-url="filesAPI"
          @fileUploaded="fetchFiles"
          flat)
      q-card-section.bg-secondary.text-white
        h5 Uploaded files
      q-card-section
        .row.q-py-md.q-gutter-md
          q-item.col-auto.q-pa-lg(
            v-for="att in s3Files"
            clickable
            :key="att.key"
            @click="downloadFile(att)")
            q-item-section(top avatar)
              q-avatar(text-color="accent" icon="picture_as_pdf")
            q-item-section
              q-item-label {{ att.key }}
              q-item-label(caption) {{ att.size }} kb

</template>

<script>
import { openURL } from 'quasar'
import { Component, Vue } from 'vue-property-decorator'
import FileUploader from 'src/components/FileUploader'

export default @Component({
  name: 'Index',
  components: {
    FileUploader
  }
})
class Index extends Vue {
  s3Bucket = ''
  s3Files = []

  created () {
    this.fetchFiles()
  }

  get filesAPI () {
    return `https://127.0.0.1/api/files/${this.s3Bucket}`
  }

  downloadFile (file) {
    openURL(`${this.filesAPI}/${file.key}`)
  }

  fetchFiles () {
    this.$axios.get(this.filesAPI)
      .then((response) => {
        this.s3Files = response.data.contents
      })
      .catch(() => {
        this.$q.notify({
          color: 'negative',
          position: 'top',
          message: 'Loading failed',
          icon: 'report_problem'
        })
      })
  }
}
</script>
