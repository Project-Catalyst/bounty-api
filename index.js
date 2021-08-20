'use strict'
import http from 'http'
import api from './src/api'
import logger from './src/logger'


const port = process.env.PORT || 6000
const server = http.createServer(api)

server.listen(port, () =>{
    logger.info(`CCS API started successfully on port ${port}`)
})


