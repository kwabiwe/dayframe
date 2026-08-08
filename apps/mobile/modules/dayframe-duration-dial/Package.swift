// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeDurationDialCore",
  platforms: [.macOS(.v13), .iOS(.v16)],
  products: [
    .library(name: "DayframeDurationDialCore", targets: ["DayframeDurationDialCore"])
  ],
  targets: [
    .target(
      name: "DayframeDurationDialCore",
      path: "ios",
      exclude: [
        "DayframeDurationDial.podspec",
        "DayframeDurationDialExpoView.swift",
        "DayframeDurationDialModule.swift"
      ],
      sources: ["DayframeDurationDialCore.swift"]
    ),
    .testTarget(
      name: "DayframeDurationDialCoreTests",
      dependencies: ["DayframeDurationDialCore"],
      path: "Tests"
    )
  ]
)
