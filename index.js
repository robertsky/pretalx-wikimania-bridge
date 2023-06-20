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

const connPretalx = axios.create({
  baseURL: 'https://pretalx.com/api/events/' + process.env.PRETALX_EVENT_ID + '/',
  headers: {
    'Content-Type' :'application/json',
    'Authorization': 'Token ' + process.env.PRETALX_API_KEY
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


let importRoutine = getAllSubmissions('/submissions/?questions=2340,2329,2330&limit=25').then(pretalxData => {

  if (!!pretalxData.count) {
    _.forEach(pretalxData.results, submission => {
      wmSpearkersNew = _.union(wmSpearkersNew, submission.speakers);
      if (!!wmSpearkersOld.length) { // those that are left here are speaker profiles that can be deleted
        _.forEach(submission.speakers, newSpeaker => {
          _.remove(wmSpearkersOld, speaker => {
            return speaker.code === newSpeaker.code;
          });
        });
      }

      // get track from submission
      // add submission to the new submission list.

      /* 
        old submission format: {
          id: 'code',
          track: 'track name',
          track_id: 'track_id',
          state: 'state',
          'pagename'
        }
      */

      let submissionObj = {
        id: submission.code,
        track: submission.track.en,
        track_id: submission.track_id,
        state: submission.state,
      };

      wmSubmissionListNew.push(submissionObj);
      if (!!wmSubmissionListOld.length) { // those that are left here are submissions that have been deleted on pretalx
        _.remove(wmSubmissionListOld, oldSubmission => { 
          return oldSubmission.id === submissionObj.id;
        });
      }

    })
  }
  return pretalxData;
}).then(async pretalxData => {
  botLogin();
  _.forEach(pretalxData.results, async proposal => {
    let speakersStr = '';
    _.forEach(proposal.speakers, async speaker => {
      speakersStr += '{{2023 speaker details/' + speaker.code + '}}';
      await connWM.edit('Template:2023 speaker details/'+ speaker.code, 
        '{{2023 speaker details|name='+speaker.name + '|biography='+ speaker.biography+'}}<noinclude><languages/></noinclude>',
        'Syncing speaker details'
        );
      console.log('syncing speaker details: ' + speaker.code);
    });
    //build submission template:

    let submissionTplStr = ''

    let trunTitleStr = trunc(proposal.title.trim(), 200);
    trunTitleStr = trunTitleStr.replaceAll(/[\[\]\{\}\|#<>\?\+\!]/g, '');
    if (trunTitleStr !== proposal.title) {
      submissionTplStr += '{{DISPLAYTITLE:'  + process.env.WIKIMANIA_PROGRAM_PAGE + '/Submissions/' + proposal.title + ' - ' + proposal.code + '}}\n\n';
    }
    
    submissionTplStr += '{{2023 session details|\n' +
      'title=' + proposal.title + '|\n' +
      'speakers={{2023 speaker wrapper|' + speakersStr + '}}|\n' +
      'track={{2023 track name|' + proposal.track_id + '}}|\n' +
      'track_id=' + proposal.track_id + '|\n' +
      'type={{2023 session type|' + proposal.submission_type_id + '}}|\n' +
      'state=' + proposal.state + '|\n' + 
      'duration=' + proposal.duration + '|\n' +
      'do_not_record=' + proposal.do_not_record + '|\n' +
      'locale=' + proposal.content_locale + '|\n' +
      'abstract=' + proposal.abstract + '|\n' +
      'description=' + proposal.description + '|\n' + 
      'created=' + proposal.created + '|\n';
    _.forEach(proposal.answers, answer => {
      switch (answer.question.id) {
      case 2340:
        submissionTplStr += 'ans_1=' + answer.answer + '|\n';
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
    });
    submissionTplStr += '}}\n<languages/>';
    await connWM.edit(process.env.WIKIMANIA_PROGRAM_PAGE + '/Submissions/' + trunTitleStr + ' - ' + proposal.code, submissionTplStr,
                'Syncing proposal from pretalx');
    console.log('Syncing submission page: ' + process.env.WIKIMANIA_PROGRAM_PAGE + '/Submissions/' + proposal.title + ' - ' + proposal.code);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
  });

  

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
