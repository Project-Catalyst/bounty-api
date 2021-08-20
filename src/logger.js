import winston from 'winston'

const loggerConfig = {
    level: 'debug',
    'transports':[
        new winston.transports.Console(),
        new winston.transports.File({
            filename:'logs/log.json'
        })
    ],
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
}
const logger = winston.createLogger(loggerConfig)


export default logger