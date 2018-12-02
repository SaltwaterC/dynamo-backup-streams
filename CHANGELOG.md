## v0.2.2
 * Merge [#3 - Add support for creating streams that handle a subset of the total segments](https://github.com/SaltwaterC/dynamo-backup-streams/pull/3)
 * Merge [#4 - Fix bad this reference, use self instead](https://github.com/SaltwaterC/dynamo-backup-streams/pull/4)

## v0.2.1
 * Fix [#1](https://github.com/SaltwaterC/dynamo-backup-streams/issues/1) - `Restore._streamRecords` attempted to write empty batch as it failed to return when `records.length === 0`.

## v0.2.0
 * Decouple aws-sdk from this library.

## v0.1.0
 * Initial release featuring Backup and Restore streams
Fix bad this reference, use self instead
