import Vue from 'vue'
import axios from 'axios'

axios.defaults.headers.common['Content-Type'] = 'application/json'

Vue.prototype.$axios = axios
