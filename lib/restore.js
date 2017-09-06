'use strict';

var util = require('util');
var readline = require('readline');
var Transform = require('stream').Transform;

var AWS = require('aws-sdk');

function Restore(options) {
  this.table = options.table;
  this.batchSize = options.batchSize;
  this.concurrency = options.concurrency;

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
    this._processBatch(this.batch.slice(0), 0);
    this.batch = [];

    this.inFlight++;
    if (this.inFlight >= this.concurrency) {
      this.readline.pause();
    }
  }
};

Restore.prototype._processBatch = function(batch, retries) {
  var self = this;

  // DDB batch writes placeholder
  setTimeout(function() {
    self._pressureControl();
    console.log(self.inFlight);
    self.processedLines += batch.length;
  }, 100);
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

Restore.prototype._drainBatch = function() {
  while (this.batch.length > 0) {
    this.inFlight++;
    this._processBatch(this.batch.splice(0, this.batchSize), 0);
  }
};

module.exports = Restore;
