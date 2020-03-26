const _ = require("lodash");
const asyncjs = require("async");
const taws = require("@turbot/aws-sdk");
const tfn = require("@turbot/fn");
const utils = require("turbot-utils");

exports.control = tfn((turbot, $, callback) => {
  const connParams = {
    region: $.item.turbot.custom.aws.regionName
  };

  const serviceConn = taws.connect("ApiGatewayV2", connParams);

  // Show tag values
  turbot.sensitiveExceptions = ["Key"];

  asyncjs.auto(
    {
      resource: [
        cb => {
          const params = { ApiId: $.item.ApiId };
          serviceConn.getApi(params, (err, data) => {
            cb(err, data);
          });
        }
      ]
    },
    (err, results) => {
      if (err) {
        const resourceNotFoundErrorCodes = ["NotFoundException"];
        // If the resource cannot be found then it should be removed from the
        // Turbot CMDB
        if (resourceNotFoundErrorCodes.includes(_.get(err, "code"))) {
          // If the resource has been created but is not available from the API
          // yet, throw the non-fatal error to fall back on our retry logic to
          // allow the API time to catch up. This most likely occurs when
          // resource creation occurs through the real-time events.
          if (!utils.expiredMinutes($.item.turbot.createTimestamp, 1)) {
            turbot.log.info("Resource was created within the last minute, throwing non-fatal error to force retry");
            return callback(err);
          }
          // Resource is older than 1 minute, so delete it
          turbot.resource.delete();
          // Immediately return instead of setting a Turbot state to avoid
          // conflicts
          return callback(null, null);
        }
        const nonFatalErrorCodes = ["InternalFailure", "ServiceUnavailable", "ThrottlingException"];
        // Fatal errors will be logged and not retried
        err.fatal = !nonFatalErrorCodes.includes(_.get(err, "code"));
        return callback(err);
      }
      const result = results.resource;

      const turbotData = {
        tags: result.Tags,
        custom: {
          createTimestamp: result.CreatedDate,
          aws: $.item.turbot.custom.aws
        }
      };

      turbot.resource.putPaths(result, turbotData);

      callback(null, turbot.ok());
    }
  );
});
