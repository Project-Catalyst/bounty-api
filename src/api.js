/*jshint -W033 */
/*jshint -W119 */
'use strict'
import 'dotenv/config';
import express from 'express'
import  { Octokit } from 'octokit'
import { createAppAuth } from "@octokit/auth-app";
import axios from 'axios'
// import cors from 'cors'
import cookieParser from 'cookie-parser';
import session from 'cookie-session';
import logger from './logger'
import fs from 'fs'

const WWW_HOST = require(`./constants.${process.env.NODE_ENV}`).WWW_HOST
const ALLOW_ORIGIN = require(`./constants.${process.env.NODE_ENV}`).ALLOW_ORIGIN
//Telling axios to use cookies
axios.defaults.withCredentials = true

const privateKey = fs.readFileSync('./secrets/bountylister.2021-08-05.private-key.pem','utf8')
const ORG = 'Project-Catalyst' 
const REPO = 'project-catalyst.github.io'
const BH_NEEDED_LBL = 'bounty-hunter-needed'
const BH_ASSIGNED_LBL = 'bounty-hunter-assigned'
const CACHE_DURATION_MS = 120000

const state = {
    authentication : null,
    bountiesWithHunterNeeded:[],
    bountiesWithHunterNeededLastUpdated: null,
    bountiesWithHunterAssigned:[],
    bountiesWithHunterAssignedLastUpdated: null,
    users : {}
}

const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth:{
        appId: 129703,
        privateKey: privateKey,
        installationId: 18637253
    }
})



async function authenticate(){
    try {
        state.authentication = await octokit.rest.apps.getAuthenticated();
        logger.debug(state.authentication)
    }catch(e){
        logger.error(e)
    }
}

async function getBountiesWithHunterAssigned(){

    if(Date.now()-state.bountiesWithHunterAssignedLastUpdated < CACHE_DURATION_MS){
        return state.bountiesWithHunterAssigned
    }
    try{
        let bounties = parseIssues(await octokit.rest.issues.listForRepo({owner: ORG,repo:REPO,labels:BH_ASSIGNED_LBL}))
        await addReactions(bounties)
        // This can expanded into a caching mechanism if needed
        state.bountiesWithHunterAssigned = bounties
        state.bountiesWithHunterAssignedLastUpdated = Date.now()
        return bounties
    }catch(e){
        logger.error(e)
    }
}

async function getBountiesWithHunterNeeded(){
    if(Date.now()-state.bountiesWithHunterNeededLastUpdated < CACHE_DURATION_MS){
        return state.bountiesWithHunterNeeded
    }
    try{
        let bounties = parseIssues(await octokit.rest.issues.listForRepo({owner: ORG,repo:REPO,labels:BH_NEEDED_LBL}))
        await addReactions(bounties)
        // This can expanded into a caching mechanism if needed
        state.bountiesWithHunterNeeded = bounties
        state.bountiesWithHunterNeededLastUpdated = Date.now()
        return bounties

    }catch(e){
        logger.error(e)
    }
}

authenticate()

const api = express()

api.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    res.header('Access-Control-Allow-Credentials', true);
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

//  Populate req.cookies
api.use(cookieParser());
// We are working from behind nginx
api.set('trust proxy', 1)
//  Session setup
api.use(session({
  secret: `fs.readFileSync('./secrets/session-secret.txt','utf8')`,
  cookie: {
    maxAge: 3600000,
    secure: true,
    httpOnly: false,

  },
  saveUninitialized: false,
  resave: false,
  unset: 'destroy',
  name: 'Bounty-Voting'
}));

api.get("/",async (request,response,next) =>{
    response.json(["running"])
})
api.get(`/bounties/${BH_ASSIGNED_LBL}`,async (request,response,next) =>{
    response.json(await getBountiesWithHunterAssigned())
})
api.get(`/bounties/${BH_NEEDED_LBL}`,async (request,response,next) =>{
    response.json(await getBountiesWithHunterNeeded())
})
api.get("/github_auth",async (request,response,next) =>{
    
    logger.debug(request)

    let oauth = await axios.post('https://github.com/login/oauth/access_token',{
        client_id: 'Iv1.75f9d9c2e09de0f5',
        client_secret: `${fs.readFileSync('./secrets/secret.txt','utf8')}`,
        code: request.query.code,
        state: request.query.state
    })
    let oauth_result = {}
    oauth.data.split('&').forEach( item =>{ 
        let arr = item.split('=')
        oauth_result[`${arr[0]}`]=arr[1]
    })
    state.users[`${request.query.state}`] = oauth_result
    state.users[`${request.query.state}`].timestamp = Date.now()

    response.redirect(308,`https://${WWW_HOST}/en/bounties/`)
})

api.get("/upvote",async (request,response,next) =>{

    let issue_number = request.query.issue
    
    state.bountiesWithHunterAssignedLastUpdated = 0
    state.bountiesWithHunterNeededLastUpdated = 0
    try{
        await axios.post(`https://api.github.com/repos/${ORG}/${REPO}/issues/${request.query.issue}/reactions`,{'content':'+1'}, {
            'headers':{
                'Accept' : 'application/vnd.github.squirrel-girl-preview+json',
                'Authorization': `token ${state.users[request.query.state]['access_token']}`
            }
        })
    }catch(e){
        console.error(e)
        logger.error(e)
    }

})

api.get("/downvote",async (request,response,next) =>{

    state.bountiesWithHunterAssignedLastUpdated = 0
    state.bountiesWithHunterNeededLastUpdated = 0

    try{
        await axios.post(`https://api.github.com/repos/${ORG}/${REPO}/issues/${request.query.issue}/reactions`,{'content':'-1'}, {
            'headers':{
                'Accept' : 'application/vnd.github.squirrel-girl-preview+json',
                'Authorization': `token ${state.users[request.query.state]['access_token']}`
            }
        })
    }catch(e){
        console.error(e)
        logger.error(e)
    }

})

api.get("/can_i_vote",async (request,response,next) =>{
    
    if(request.query !== null && request.query.state !== null){
        let user = state.users[`${request.query.state}`]
        if(user!== undefined && user.timestamp !== undefined){
            logger.debug('Found signed in user',user)
            if(user.timestamp + user.expires_in*1000-Date.now() > 0){
                response.json(true)
                return
            }
        }
    }
    
    response.json(false)
})


function parseIssues(issues){
    const bounties = []
    issues.data.forEach( issue => {
        let bounty = {
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body,

            url: issue.url,
            state: issue.state,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            locked: issue.locked,
            user: {
                login: issue.user.login,
                id: issue.user.id,
                url: issue.user.url,
                avatar_url: issue.user.avatar_url
            },
            assignee: null,
            labels:[]
        }
        
        if(issue.assignee !== null){
            bounty.assignee = {
                login: issue.assignee.login,
                id: issue.assignee.id,
                url: issue.assignee.url,
                avatar_url: issue.assignee.avatar_url
            }
        }
        if(issue.labels !== null){
            issue.labels.forEach(lbl =>{
                bounty.labels.push({
                    id:lbl.id,
                    url:lbl.url,
                    name: lbl.name,
                    color:lbl.color,
                    'default': lbl['default'],
                    description: lbl.description

                })
            })
        }
        bounties.push(bounty)
    })
    return bounties
}
async function addReactions(bounties){
    return Promise.all(bounties.map( async (bounty) => {
        try{
            const reactions = await octokit.rest.reactions.listForIssue({owner: ORG,repo:REPO,issue_number: bounty.number})      
            if(reactions.data.length > 0){
                let rank = 0;
                reactions.data.forEach( reaction =>{
                    if(reaction.content === 'heart') rank = rank + 2 
                    if(reaction.content === 'rocket') rank += 3
                    if(reaction.content === '+1') rank += 1
                    if(reaction.content === '-1') rank -= 1
                })
                bounty['rank']=rank
                bounty['vote_count']=reactions.data.length
            }
            // return bounty
        
        } catch (e){
            logger.error(e)
        }
    }))
    
    
}

export default api;

