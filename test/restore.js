'use strict';

var fs = require('fs');
var zlib = require('zlib');
var ps = require('progress-stream');

var Restore = require('../lib/main').Restore;

var table = process.argv[2];

fs.stat(table + '.json.gz', function(err, stat) {
  if(err) {
    throw err;
  }

  var rs = fs.createReadStream(table + '.json.gz');
  var str = ps({
    length: stat.size,
    time: 1000
  });
  var gunzip = zlib.createGunzip();
  var rss = new Restore({
    table: table,
    capacityPercentage: 100
  });

  rs.pipe(str).pipe(gunzip).pipe(rss);

  var progress = setInterval(function() {
    var stats = str.progress();
    console.log(table + ' progress: %d / %d - %f%; read lines: %d - processed lines: %d; capacity: %d - used: %d', stats.transferred, stats.length, stats.percentage, rss.lines, rss.processedLines, rss.limit, rss.units);
  }, 1000);

  rs.on('close', function() {
    cleanInterval(progress);
  });
});

process.on('exit', function() {
  console.log();
  console.log('total lines: %d', rss.lines);
  console.log('processed lines: %d', rss.processedLines);
});
