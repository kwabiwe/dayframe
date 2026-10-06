// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeMotionActivityCore",
  platforms: [
    .macOS(.v13),
    .iOS(.v16)
  ],
  products: [
    .library(
      name: "DayframeMotionActivityCore",
      targets: ["DayframeMotionActivityCore"]
    )
  ],
  targets: [
    .target(
      name: "DayframeMotionActivityCore",
      path: "ios",
      exclude: [
        "DayframeMotionActivity.podspec",
        "DayframeMotionActivityModule.swift"
      ],
      sources: ["DayframeMotionActivityCore.swift"]
    ),
    .testTarget(
      name: "DayframeMotionActivityCoreTests",
      dependencies: ["DayframeMotionActivityCore"],
      path: "Tests"
    )
  ]
)
