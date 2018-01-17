## v0.2.1
 * Fix [#1](https://github.com/SaltwaterC/dynamo-backup-streams/issues/1) - `Restore._streamRecords` attempted to write empty batch as it failed to return when `records.length === 0`.

## v0.2.0
 * Decouple aws-sdk from this library.

## v0.1.0
 * Initial release featuring Backup and Restore streams
