// work to be done:
// pretalx api auth
// pretalx api call: submissions
// sort pretalx submission by tracks, and submission date
// pretalx api call: photos
// wikimania wiki api auth
// wikimania wiki api call: post to wiki page.
// wikimania wiki api call: upload photo

require('dotenv').config();
const _ = require('lodash');
const axios = require('axios');
const MWBot = require('mwbot');
const packageJson = require('./package.json');
const trunc = require('unicode-byte-truncate');
const Title = require('mediawiki-title');
const nodePandoc = require('node-pandoc-promise');
const tp = require('timers/promises');
const URL = require('url').URL;
const DateTime = require('luxon').DateTime;


const stringIsAValidUrl = (s) => {
  try {
    new URL(s);
    return true;
  } catch (err) {
    return false;
  }
};

// pandoc
let pdArgs = ['-f', 'markdown', '-t', 'mediawiki'];

const connPretalx = axios.create({
  baseURL: 'https://pretalx.com/api/events/' + process.env.PRETALX_EVENT_ID + '/',
  headers: {
    'Content-Type' :'application/json',
    'Authorization': 'Token ' + process.env.PRETALX_API_KEY,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  }
});

const loginCredWM = {
  username  : process.env.WIKIMANIA_USER,
  password  : process.env.WIKIMANIA_PASS
};

let connWM = new MWBot({
  apiUrl    : process.env.WIKIMANIA_API_URL
});
connWM.setGlobalRequestOptions({
  headers: {
      'User-Agent': 'mwbot/' + connWM.version + ', The Sky Bot: Pretalx bridge task/' + packageJson.version
  },
  verbose: true,
});
console.log('mwbot/' + connWM.version + ', The Sky Bot: Pretalx bridge task/' + packageJson.version);

async function botLogin() {
  if (!connWM.editToken) {
    await connWM.loginGetEditToken(loginCredWM).catch(err=>{console.warn('Error ', err)});
  }

  return !!connWM.editToken;
}

/* 
  build tracks array
*/
const pretalxTracksList = process.env.PRETALX_TRACKS;
let pretalxTracksArr = [];
_.forEach(pretalxTracksList.split('|'), trackPair => {
  pretalxTracksArr.push({ id: parseInt(trackPair.split(':')[0]), track: trackPair.split(':')[1] })
});
let wmSubmissionListNew = [];
let wmSubmissionListOld = []; // retrieve from wikimania.
let wmSpearkersNew = [];
let wmSpearkersOld = []; // retrieve from wikimania.
let locSubmissionList = process.env.WIKIMANIA_PROGRAM_PAGE + '/data/submission list.json';
let locSpeakerList = process.env.WIKIMANIA_PROGRAM_PAGE + '/data/speaker list.json';

async function loadWmData() {
  await botLogin();

  await connWM.read(locSubmissionList+'|'+locSpeakerList).then((response) => {
    let respPages = response.query.pages;
    _.forEach(respPages, respPage => {
      let respKeys = _.keys(respPages);
      if (!_.includes(respKeys, 'missing')) {
        if (respPages.title === locSpeakerList) {
          wmSpearkersOld = respPage.list;
        }
        if (respPages.title === locSubmissionList) {
          wmSubmissionListOld === respPage.list;
        }
      }

    })
  }).catch((err) => {
    console.warn('Error', err);
  });
  return;
}


function customizer(objValue, srcValue) {
    if (_.isArray(objValue)) {
        return objValue.concat(srcValue);
    }
}

async function getAllSubmissions(url, data) {
  data = data || {};
  console.log('loading pretalx api:' + url);
  //console.log(!!data.results ? data.results.length : 0);

  await loadWmData();

  await connPretalx.get(url).then(response => {
    _.mergeWith(data, response.data, customizer)

    if (response.data.next !== null) {
      return getAllSubmissions(response.data.next, data);
    }
  }).catch(err=> {
    console.warn('Error', err);
  });

  return data;
}

let slots = [
  {start: '9:00', end: '9:15'},
  {start: '9:15', end: '9:30'},
  {start: '9:30', end: '9:45'},
  {start: '9:45', end: '10:00'},
  {start: '10:00', end: '10:15'},
  {start: '10:15', end: '10:30'},
  {start: '10:30', end: '10:45'},
  {start: '10:45', end: '11:00'},
  {start: '11:00', end: '11:15'},
  {start: '11:15', end: '11:30'},
  {start: '11:30', end: '11:45'},
  {start: '11:45', end: '12:00'},
  {start: '12:00', end: '12:15'},
  {start: '12:15', end: '12:30'},
  {start: '12:30', end: '12:45'},
  {start: '12:45', end: '13:00'},
  {start: '13:00', end: '13:15'},
  {start: '13:15', end: '13:30'},
  {start: '13:30', end: '13:45'},
  {start: '13:45', end: '14:00'},
  {start: '14:00', end: '14:15'},
  {start: '14:15', end: '14:30'},
  {start: '14:30', end: '14:45'},
  {start: '14:45', end: '15:00'},
  {start: '15:00', end: '15:15'},
  {start: '15:15', end: '15:30'},
  {start: '15:30', end: '15:45'},
  {start: '15:45', end: '16:00'},
  {start: '16:00', end: '16:15'},
  {start: '16:15', end: '16:30'},
  {start: '16:30', end: '16:45'},
  {start: '16:45', end: '17:00'},
  {start: '17:00', end: '17:15'},
  {start: '17:15', end: '17:30'},
  {start: '17:30', end: '17:45'},
  {start: '17:45', end: '18:00'},
  {start: '18:00', end: '18:15'},
  {start: '18:15', end: '18:30'},
  {start: '18:30', end: '18:45'},
  {start: '18:45', end: '19:00'},
  {start: '19:00', end: '19:15'},
  {start: '19:15', end: '19:30'},
  {start: '19:30', end: '19:45'},
  {start: '19:45', end: '20:00'},
  {start: '20:00', end: '20:15'},
  {start: '20:15', end: '20:30'},
  {start: '20:30', end: '20:45'},
  {start: '20:45', end: '21:00'},
]; 


function minuteBlock(minute) {
  let block = 0
  if ( 1 =< minute =< 15 ) {
    block = 15;
  } else if ( 16 =< minute =< 30 ) {
    block = 30;
  } else if ( 31 =< minute =< 45 ) {
    block = 45;
  } else if ( 46 =< minute =< 60 ) {
    block = 60;
  }
  return block;
}

function calcSlotNumber(hour,minute,baseHour,startStopSwitch) {

  if (startStopSwitch === 'stop') {
    if minute === 0 {
      minute = 60;
    }

    minute -= 15;

    if (minute < 0 ) {
      hour -= 1;
      minute = 60 - minute;
    } else if (minute > 44) {
      hour -= 1;
    }

  }

  hour * 4 + (Math.floor(minute/15) + 1);

  let multiplier = 1;
  if (startStopSwitch === 'start') {
    multiplier = Math.floor(minute/15) + 1;
  } else {
    multiplier = Math.ceil(minute/15);
  }
  return hour * 4 + multiplier;

}

function roomNumber(room) {

  let roomArr = ['Plenary Hall', 'Room 307', 'Room 308', 'Room 309', 'Room 310', 'Room 311', 'Room 324', 'Room 325', 'Room 326', 'Expo space', 'Concourse Area', 'Imagination Room, National Library', 'Park Royal Hotel Sky Ballroom', 'Gardens by the Bay'];

  return roomArr.indexOf(room) > -1 ? roomArr.indexOf(room) + 1;
}


[
  {
    startslot: 1,
    endslot: 1,
    room: 1,
    display: 'display text 1231231'
  },


]

let importRoutine = getAllSubmissions('/submissions/?questions=2340,2329,2330&state=confirmed&limit=25').then(pretalxData => {



  if (!!pretalxData.results) {
    let tableArray = [];

    for (var i = pretalxData.results.length - 1; i >= 0; i--) {
      let submission = pretalxData.results[i];\
      // determine start and end slots of session:
      let startTime = !!submission.slot ? submission.slot.start : '';
      let endTime = !!submission.slot ? submission.slot.end : '';
      let startSlot = 0;
      let endSlot = 0;
      if (startTime) {
        startTime = DateTime.fromISO(startTime);
        endTime = DateTime.fromISO(endTime);
        if (startTime) {

          startSlot = calcSlotNumber(startTime.get('hour'), startTime.get('minute'), 9, start);

          endSlot = calcSlotNumber(endTime.get('hour'), endTime.get('minute'), 9, stop);

          let newTitle = trunc(process.env.WIKIMANIA_PROGRAM_PAGE + '/' + track + '/' + submission.code + '-' + submission.title.replaceAll(/[\[\]\|#<>]/g, '').trim(), 255);

          tableArray.push({
            startslot: startSlot,
            endslot: endSlot,
            room: roomNumber(submission.slot.room.en),
            display: '[[' + newTitle + '|' + submission.title + ']]\n[https://etherpad.wikimedia.org/p/' + submission.code + ' Etherpad]';
          });
        }

        
      }
      tableArray.push({
        startslot: calcSlotNumber(startTime)
      });
    }



    let wmSpeakers = [];
    _.forEach(pretalxData.results, submission => {
      let speakers = submission.speakers;
      //console.log(submission.speakers);
      wmSpeakers = _.union(wmSpeakers, speakers);
      console.log(wmSpeakers.length);
    });
    
  }
  return pretalxData;
}).catch(err=> {
  console.warn('Error', err);;
}) ;