import Foundation

// Compile and execute the exact resolver linked into both native targets.
var checks = 0
func check(_ value: Any?, _ bundle: String?, _ expected: String?, _ label: String) {
  let actual = DayframeSharedStorageConfiguration.appGroupIdentifier(
    configuredValue: value, bundleIdentifier: bundle
  )
  precondition(actual == expected, "\(label): expected \(String(describing: expected)), got \(String(describing: actual))")
  checks += 1
}

for identity in ["com.layereight.dayframe", "com.layereight.dayframe.staging"] {
  let group = "group.\(identity)"
  let otherGroup = identity.hasSuffix(".staging")
    ? "group.com.layereight.dayframe" : "group.com.layereight.dayframe.staging"
  for bundle in [identity, "\(identity).DayframeLiveActivity"] {
    check(group, bundle, group, "configured host/extension")
    for invalid: Any? in [nil, "", "$(DAYFRAME_APP_GROUP)", otherGroup, " \(group)", "\(group) ", 42, [group]] {
      check(invalid, bundle, nil, "invalid configuration must fail closed")
    }
  }
}
for bundle: String? in [nil, "", "com.layereight.dayframe.staging.other", "com.layereight.dayframe.other"] {
  check("group.com.layereight.dayframe", bundle, nil, "unknown bundle must fail closed")
  check("group.com.layereight.dayframe.staging", bundle, nil, "unknown bundle must fail closed")
}
print("Native shared storage identity validation passed: \(checks) checks.")
