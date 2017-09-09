'use strict';

var util = require('util');
var Readable = require('stream').Readable;

var AWS = require('aws-sdk');

function Backup(options) {
  this.table = options.table;
  this.capacityPercentage = options.capacityPercentage || 25;
  this.retries = options.retries || 10;
  this.delay = options.delay || 1000;

  this.capacityTimeout = null;
  this.itemsCount = 0;
  this.itemsProcessed = 0;

  this.ddb = new AWS.DynamoDB();
  Readable.call(this, options);

  this._readTable();
}
util.inherits(Backup, Readable);

Backup.prototype._read = function() {
  return 0;
};

Backup.prototype._end = function() {
  this.push(null);
  clearInterval(this.capacityTimeout);
};

Backup.prototype._setCapacity = function(units) {
  var readPercentage = (units * this.capacityPercentage / 100) | 0;
  this.limit = Math.max(readPercentage, 1);
};

Backup.prototype._readTable = function() {
  var self = this;

  this.ddb.describeTable({
    TableName: this.table
  }, function(err, data) {
    if (err) {
      return self.emit('error', err);
    }

    self.itemsCount = data.Table.ItemCount;
    self._setCapacity(data.Table.ProvisionedThroughput.ReadCapacityUnits);
    self.useLimit = self.limit;
    self._streamRecords(null, 0);
  });

  // update the capacity limit every minute if auto scaling kicks in
  this.capacityTimeout = setInterval(function() {
    self.ddb.describeTable({
      TableName: self.table
    }, function(err, data) {
      self._setCapacity(data.Table.ProvisionedThroughput.ReadCapacityUnits);
    });
  }, 60000);
};

Backup.prototype._streamRecords = function(startKey, retries) {
  var self = this;
  var startTime = Date.now();

  // don't buffer data in the stream if the stream is paused
  if (this.isPaused()) {
    return setTimeout(function() {
      self._streamRecords(startKey, 0);
    }, 250);
  }

  var options = {
    TableName: this.table,
    Limit: this.useLimit,
    ReturnConsumedCapacity: 'TOTAL'
  };

  if (startKey) {
    options.ExclusiveStartKey = startKey;
  }

  this.ddb.scan(options, function(err, data) {
    var idx;
    var endTime = Date.now();

    if (err) {
      if (retries >= self.retries) {
        clearInterval(self.capacityTimeout);
        var error = new Error('Fail: too many retries when reading records');
        error.dynamoError = err;
        return self.emit('error', error);
      }

      return setTimeout(function() {
        retries++;
        self._streamRecords(startKey, retries);
      }, 1000 * retries);
    }

    if (data.Items.length > 0) {
      for (idx in data.Items) {
        self.push(JSON.stringify(data.Items[idx]) + '\n');
        self.itemsProcessed++;
      }
    }

    // dynamically scale read capacity based on record sizes rather than
    // a limit which is pegged against the number of records returned
    self.units = data.ConsumedCapacity.CapacityUnits;
    self.useLimit = self.useLimit * self.limit / self.units | 0;
    self.useLimit = Math.max(self.useLimit, 1);

    self.emit('progress', {
      count: self.itemsCount,
      processed: self.itemsProcessed
    });

    if (!data.LastEvaluatedKey) {
      self._end();
    } else {
      setTimeout(function() {
        self._streamRecords(data.LastEvaluatedKey, 0);
      }, self.delay - (endTime - startTime));
    }
  });
};

module.exports = Backup;
