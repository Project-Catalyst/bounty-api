'use strict'
import 'dotenv/config';
import http from 'http'
import api from './src/api'
import logger from './src/logger'

const PORT = require(`./src/constants.${process.env.NODE_ENV}`).PORT
const port = PORT || 6000
const server = http.createServer(api)

server.listen(port, () =>{
    logger.info(`CCS API started successfully on port ${port}`)
})


