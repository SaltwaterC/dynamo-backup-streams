'use strict';

var util = require('util');
var readline = require('readline');
var Transform = require('stream').Transform;

var AWS = require('aws-sdk');

function Restore(options) {
  this.table = options.table;
  this.batchSize = options.batchSize || 25;
  this.concurrency = options.concurrency || 10;
  this.retries = options.retries || 10;

  this.ddb = new AWS.DynamoDB();
  Transform.call(this, options);

  this.lineBuffer = [];
  this.batch = [];
  this.inFlight = 0;

  this._readLines();

  this.lines = 0;
  this.processedLines = 0;
}
util.inherits(Restore, Transform);

Restore.prototype._transform = function(chunk, encoding, callback) {
  this.push(chunk);
  callback();
};

Restore.prototype._drainBatch = function() {
  while (this.batch.length > 0) {
    this.inFlight++;
    this._processBatch(this.batch.splice(0, this.batchSize));
  }
};

Restore.prototype._readLines = function() {
  var self = this;

  this.readline = readline.createInterface({
    input: this,
    terminal: false
  });

  this.readline.on('line', function(line) {
    self.lines++;
    self._batchLine(line);
  });

  this.readline.on('close', function() {
    self._drainBatch();
  });
};

Restore.prototype._batchLine = function(line) {
  if (this.isPaused()) {
    return this.lineBuffer.push(line);
  }

  this.batch.push(line);
  if (this.batch.length === this.batchSize) {
    this._processBatch(this.batch.splice(0));

    this.inFlight++;
    if (this.inFlight >= this.concurrency) {
      this.readline.pause();
    }
  }
};

Restore.prototype._processBatch = function(batch) {
  var idx, items = [];

  for (idx in batch) {
    items.push({
      PutRequest: {
        Item: JSON.parse(batch[idx])
      }
    });
  }

  var reqItems = {
    RequestItems: {}
  };
  reqItems.RequestItems[this.table] = items;

  this._writeBatch(reqItems, items.length, 0);
};

Restore.prototype._pressureControl = function() {
  this.inFlight--;
  if (this.inFlight < this.concurrency) {
    this.readline.resume();

    // drain the line buffer
    while (this.lineBuffer.length > 0 && this.inFlight < this.concurrency) {
      this._batchLine(this.lineBuffer.shift());
    }
  }

  if (this.inFlight === 0 && this.batch.length > 0) {
    this._drainBatch();
  }
};

Restore.prototype._writeBatch = function(items, size, retries) {
  var self = this;

  if (retries >= this.retries) {
    var error = new Error('Fail: too many retries when writing batch');
    error.items = items;
    return this.emit('error', error);
  }

  this.ddb.batchWriteItem(items, function(err, res) {
    if (err) {
      retries++;
      return setTimeout(function() {
        self._writeBatch(items, size, retries);
      }, 1000 * retries);
    }

    if (res.UnprocessedItems && res.UnprocessedItems[self.table]) {
      // retry unprocessed items
      var remaining = res.UnprocessedItems[self.table].length;

      if (size === remaining) {
        // no items have been written - seems unlikely without an error being
        // passed to the completion callback but it'd rather sit in the pub
        // with a pint than debug *this*
        retries++;
        setTimeout(function() {
          self._writeBatch(items, size, retries);
        }, 1500 * retries);
      } else {
        // some items have been written - reset the counter to avoid edge cases
        setTimeout(function() {
          self._writeBatch(res.UnprocessedItems, remaining, 0);
        }, 1000);
        self.processedLines += size - remaining;
      }
    } else {
      self._pressureControl();
      self.processedLines += size;
    }
  });
};

module.exports = Restore;
