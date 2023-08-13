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


async function upsertSpeakers(speakerData) {
  console.log(speakerData.length);
  await botLogin();
  for (const speaker of speakerData) {
    console.log('processing speaker details: ' + speaker.code);
    let biography = speaker.biography;
    let bioCallback = function (err, result) {
      if (err) console.error('Oh Nos: ',err);
      // Without the -o arg, the converted value will be returned.
      biography =  result;
    };

    if (!biography || biography === '.') { //pandoc fails at processing just '.'
      biography = '';
    }
    if (!!biography && !stringIsAValidUrl(biography)) {
      //console.log('actual version: ' + biography)
      biography = await nodePandoc(biography, pdArgs);
      //console.log('pandoc version: ' + biography);
    }

    await connWM.edit('Template:2023 speaker details/'+ speaker.code, 
      '{{2023 speaker details|name='+speaker.name + '|biography='+ biography+'}}<noinclude><languages/></noinclude>',
      'Syncing speaker details'
      );
    
    tp.setTimeout(100);
  }
  return;
}

async function moveSessions(pretalxData) {
  /*
    if there is a current page:
      yes:
        check if current title is the new title:
          yes:
            update current page.
          no:
            move current page to new title.
            update current page.
      no:
        create page at current title
  */
  await botLogin();
  for (const submission of pretalxData.results) {
    console.log('processing move of ' + submission.code);
    let track = submission.track.en;
    switch (track) {
      case 'Lightning talk showcase (5 minute duration each. Plenary)':
        track = 'Lightning talk showcase';
        break;
      case 'Poster sessions (9 to 11 UTC all posters)':
        track = 'Poster sessions';
        break;
      case 'Inclusion (WikiWomen)':
        track = 'WikiWomen';
        break;
      case 'ESEAP (East, South East Asia, & the Pacific) Region':
        track = 'ESEAP Region';
        break;
    }
    let newTitle = trunc(process.env.WIKIMANIA_PROGRAM_PAGE + '/' + track + '/' + submission.code + '-' + submission.title.replaceAll(/[\[\]\|#<>]/g, '').trim(), 255);
    let currentTitle = '';
    let toMove = await connWM.request({
      'action': 'query',
      'list': 'search',
      'srsearch': submission.code,
      'format': 'json',
      'srnamespace': 136
    }).then((resp) => {
      //console.log(resp.query.search[0]);
      if (resp.query.searchinfo.totalhits === 1) {
        currentTitle = resp.query.search[0].title;
        
        if (currentTitle !== newTitle) {
          return true;
        } else {
          console.log('201: ' + submission.code + ' not moved. page at destination title');
        }
      } else if (resp.query.searchinfo.totalhits > 1) {
        console.log('401: ' + submission.code + ' has multiple entries. manual check please');
      } else {
        console.log('202: '+ submission.code + ' no page found. probably new');
      }
      return false;
    }).catch((err)=>{
      console.log('search error: ' + submission.code + ' ' + err);
      return false;
    });

    if (toMove && currentTitle !== '') {
      tp.setTimeout(100);
      await connWM.request({
        'action': 'move',
        'from': currentTitle,
        'to': newTitle,
        'reason': 'publishing confirmed submissions',
        'movetalk': '1',
        'token': connWM.editToken
      }).then((moveResponse) => {
        console.log('200: ' + submission.code + ' moved.' + JSON.stringify(moveResponse));
        tp.setTimeout(100);
      }).catch((err) => {
        console.log('400: ' + submission.code + ' not moved. error' + JSON.stringify(err));
      });
    }
  }
  return;
}

async function upsertSessions(pretalxData) {
  await botLogin();
  let submissions = _.uniqBy(pretalxData.results, 'code');
  for (const submission of submissions) {
    //build submission template:

    let track = submission.track.en;
    switch (track) {
      case 'Lightning talk showcase (5 minute duration each. Plenary)':
        track = 'Lightning talk showcase';
        break;
      case 'Poster sessions (9 to 11 UTC all posters)':
        track = 'Poster sessions';
        break;
      case 'Inclusion (WikiWomen)':
        track = 'WikiWomen';
        break;
      case 'ESEAP (East, South East Asia, & the Pacific) Region':
        track = 'ESEAP Region';
        break;
    }

    let submissionTplStr = '';
    let unTruncatedTitle = process.env.WIKIMANIA_PROGRAM_PAGE + '/' + track + '/' + submission.code + '-' + submission.title.trim();
    let newTitle = trunc(process.env.WIKIMANIA_PROGRAM_PAGE + '/' + track + '/' + submission.code + '-' + submission.title.replaceAll(/[\[\]\|#<>]/g, '').trim(), 255);

    let speakersStr = '';
    _.forEach(submission.speakers, async speaker => {
      speakersStr += '{{2023 speaker details/' + speaker.code + '}}';
    });

    let abstract = ( !!submission.abstract & !stringIsAValidUrl(submission.abstract) ) ? await nodePandoc(submission.abstract, pdArgs) : submission.abstract;
    let description = ( !!submission.description & !stringIsAValidUrl(submission.description) ) ? await nodePandoc(submission.description, pdArgs) : submission.description;

    if (newTitle !== unTruncatedTitle) {
      submissionTplStr += '{{DISPLAYTITLE:'  + unTruncatedTitle + '}}\n\n';
    }
    submissionTplStr += '{{2023 session details|\n' +
    'title=' + submission.title + '|\n' +
    'speakers={{2023 speaker wrapper|' + speakersStr + '}}|\n' +
    'track={{2023 track name|' + submission.track_id + '}}|\n' +
    'track_id=' + submission.track_id + '|\n' +
    'type={{2023 session type|' + submission.submission_type_id + '}}|\n' +
    'state=' + submission.state + '|\n' + 
    'duration=' + submission.duration + '|\n' +
    'do_not_record=' + submission.do_not_record + '|\n' +
    'locale=' + submission.content_locale + '|\n' +
    'abstract=' + abstract + '|\n' +
    'description=' + description + '|\n' + 
    'created=' + submission.created + '|\n';
    for (const answer of submission.answers) {
      switch (answer.question.id) {
      case 2340:
        let ans1 = ( !!answer.answer & !stringIsAValidUrl(answer.answer) ) ? await nodePandoc(answer.answer, pdArgs) : answer.answer;
        submissionTplStr += 'ans_1=' + ans1 + '|\n';
        break;
      case 2329:
        let optionKey = ''
        switch (answer.options[0].id) {
        case 2904:
          optionKey = 'everyone';
          break;
        case 2905:
          optionKey = 'some';
          break;
        case 2906:
          optionKey = 'average';
          break;
        case 2907:
          optionKey = 'experienced';
          break;
        }
        submissionTplStr += 'ans_2=' + optionKey + '|\n';
        break;
      case 2330:
        _.forEach(answer.options, selectedOption => {
          switch (selectedOption.id) {
          case 2908: //Onsite in Singapore
            submissionTplStr += 'ans_3a=yes|\n';
            break;
          case 2909: //Remote online participation, livestreamed
            submissionTplStr += 'ans_3b=yes|\n';
            break;
          case 2910: //Remote from a satellite event
            submissionTplStr += 'ans_3c=yes|\n';
            break;
          case 2911: //Hybrid with some participants in Singapore and others dialing in remotely
            submissionTplStr += 'ans_3d=yes|\n';
            break;
          case 2959: //Pre-recorded and available on demand
            submissionTplStr += 'ans_3e=yes|\n';
            break;
          }
        })
      }
    };
    submissionTplStr += '}}\n<languages/>';

    await connWM.edit(newTitle, submissionTplStr,
                'Syncing proposal from pretalx');
    console.log('Syncing submission page: ' + newTitle);
    tp.setTimeout(100);
  }

}


let importRoutine = getAllSubmissions('/submissions/?questions=2340,2329,2330&state=confirmed&limit=25').then(pretalxData => {

  if (!!pretalxData.results) {
    let wmSpeakers = [];
    _.forEach(pretalxData.results, submission => {
      let speakers = submission.speakers;
      //console.log(submission.speakers);
      wmSpeakers = _.union(wmSpeakers, speakers);
      console.log(wmSpeakers.length);
    });
    upsertSpeakers(wmSpeakers);
  }
  return pretalxData;
})./*then(async pretalxData => {
  moveSessions(pretalxData);
  return pretalxData;
}).*/then(async pretalxData => {
  upsertSessions(pretalxData);
  return pretalxData;
}).catch(err=> {
  console.warn('Error', err);;
}) ;


//end goals:
/*
  1. each proposal to be listed under /<track>/<track title>
  2. each track page to have track description, track details, and a list of proposals submitted. TOC to consist of proposal titles as headings.
  3. when there is an update to the proposal:
      a. if there is a move to another track, do a page move of the current session page. update proposal page with updated details.
      b. if there is a withdrawal of the proposal, update the proposal page with the updated status.
      c. if there is a deletion of the proposal, mark the status of proposal as deleted in wiki, remove the proposal from listing page
      d. if there is an update of content, update the content.
*/

/*
const conn_wikimania = axios.create({
  baseURL: 'https://wikimania.wikimedia.org/w/api.php',

});*/
