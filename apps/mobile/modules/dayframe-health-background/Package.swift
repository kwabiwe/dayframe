// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeHealthBackgroundCore",
  platforms: [
    .macOS(.v13),
    .iOS(.v16)
  ],
  products: [
    .library(
      name: "DayframeHealthBackgroundCore",
      targets: ["DayframeHealthBackgroundCore"]
    )
  ],
  targets: [
    .target(
      name: "DayframeHealthBackgroundCore",
      path: "ios",
      exclude: [
        "DayframeHealthBackground.podspec",
        "DayframeHealthBackgroundAppDelegateSubscriber.swift",
        "DayframeHealthBackgroundModule.swift",
        "DayframeHealthBackgroundService.swift"
      ],
      sources: ["DayframeHealthWakeLedger.swift"]
    ),
    .testTarget(
      name: "DayframeHealthBackgroundCoreTests",
      dependencies: ["DayframeHealthBackgroundCore"],
      path: "Tests"
    )
  ]
)
