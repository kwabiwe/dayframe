// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeTrackingNoticeCore",
  platforms: [
    .macOS(.v13),
    .iOS(.v16)
  ],
  products: [
    .library(
      name: "DayframeTrackingNoticeCore",
      targets: ["DayframeTrackingNoticeCore"]
    )
  ],
  targets: [
    .target(
      name: "DayframeTrackingNoticeCore",
      path: "ios",
      exclude: [
        "DayframeTrackingNotice.podspec",
        "DayframeTrackingNoticeAppDelegateSubscriber.swift",
        "DayframeTrackingNoticeModule.swift",
        "DayframeTrackingNoticeService.swift"
      ],
      sources: ["DayframeTrackingNoticeCore.swift"]
    ),
    .testTarget(
      name: "DayframeTrackingNoticeCoreTests",
      dependencies: ["DayframeTrackingNoticeCore"],
      path: "Tests"
    )
  ]
)
