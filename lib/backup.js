'use strict';

var util = require('util');
var Readable = require('stream').Readable;

var AWS = require('aws-sdk');

function Backup(options) {
  this.table = options.table;
  this.capacityPercentage = options.capacityPercentage || 25;
  this.ddb = new AWS.DynamoDB();
  Readable.call(this, options);
  this._readTable();
}
util.inherits(Backup, Readable);

Backup.prototype._read = function() {
  var ret = this.push(this._data);
  this._data = undefined;
  return ret;
};

Backup.prototype.add = function(data) {
  this._data = data;
  this.read(0);
};

Backup.prototype.end = function() {
  this.push(null);
  this.emit('close');
};

Backup.prototype._readTable = function() {
  var self = this;

  this.ddb.describeTable({
    TableName: this.table
  }, function(err, data) {
    if (err) {
      return self.emit('error', err);
    }

    var units = data.Table.ProvisionedThroughput.ReadCapacityUnits;
    var readPercentage = (units * self.capacityPercentage / 100) | 0;

    self.limit = Math.max(readPercentage, 1);
    self._streamRecords(null);
  });
};

Backup.prototype._streamRecords = function(startKey) {
  var self = this;

  // don't buffer data in the stream if the stream is paused
  if (this.isPaused()) {
    return setTimeout(function() {
      self._streamRecords(startKey);
    }, 250);
  }

  var options = {
    Limit: this.limit,
    ReturnConsumedCapacity: 'NONE',
    TableName: this.table
  };

  if (startKey) {
    options.ExclusiveStartKey = startKey;
  }

  this.ddb.scan(options, function(err, data) {
    var idx;

    if (err) {
      return self.emit('error', err);
    }

    if (data.Items.length > 0) {
      for (idx in data.Items) {
        self.add(JSON.stringify(data.Items[idx]) + '\n');
      }
    }

    if (!data.LastEvaluatedKey) {
      self.end();
    } else {
      self._streamRecords(data.LastEvaluatedKey);
    }
  });
};

module.exports = Backup;
