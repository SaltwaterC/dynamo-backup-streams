'use strict';

var AWS = require('aws-sdk');

module.exports = function(opt) {
  var ret = {};

  if (opt.region) {
    ret.region = opt.region;
  }

  if (opt.region && opt.accessKeyId && opt.secretAccessKey) {
    ret.accessKeyId = opt.accessKeyId;
    ret.secretAccessKey = opt.secretAccessKey;
    if (opt.sessionToken) {
      ret.sessionToken = opt.sessionToken;
    }
  } else if (opt.profile) {
    ret.credentials = new AWS.SharedIniFileCredentials({
      profile: opt.profile
    });
  }

  return ret;
};
