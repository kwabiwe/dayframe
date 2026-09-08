const appJson = require("./app.json");

const production = {
  name: "Dayframe",
  scheme: "dayframe",
  bundleIdentifier: "com.layereight.dayframe",
  appGroup: "group.com.layereight.dayframe",
  keychainGroup: "$(AppIdentifierPrefix)com.layereight.dayframe.shared",
  liveActivityBundleIdentifier: "com.layereight.dayframe.DayframeLiveActivity",
};

const staging = {
  name: "Dayframe Staging",
  scheme: "dayframe-staging",
  bundleIdentifier: "com.layereight.dayframe.staging",
  appGroup: "group.com.layereight.dayframe.staging",
  keychainGroup: "$(AppIdentifierPrefix)com.layereight.dayframe.staging.shared",
  liveActivityBundleIdentifier:
    "com.layereight.dayframe.staging.DayframeLiveActivity",
};

module.exports = () => {
  const identity = process.env.EAS_BUILD_PROFILE === "preview" ? staging : production;
  const config = appJson.expo;
  const appExtension = config.extra.eas.build.experimental.ios.appExtensions[0];

  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: identity.bundleIdentifier,
      entitlements: {
        ...config.ios.entitlements,
        "com.apple.security.application-groups": [identity.appGroup],
        "keychain-access-groups": [identity.keychainGroup],
      },
    },
    extra: {
      ...config.extra,
      eas: {
        ...config.extra.eas,
        build: {
          ...config.extra.eas.build,
          experimental: {
            ...config.extra.eas.build.experimental,
            ios: {
              ...config.extra.eas.build.experimental.ios,
              appExtensions: [
                {
                  ...appExtension,
                  bundleIdentifier: identity.liveActivityBundleIdentifier,
                  entitlements: {
                    ...appExtension.entitlements,
                    "com.apple.security.application-groups": [identity.appGroup],
                    "keychain-access-groups": [identity.keychainGroup],
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
};
