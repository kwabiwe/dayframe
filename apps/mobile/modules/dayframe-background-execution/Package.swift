// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeBackgroundExecutionCore",
  platforms: [
    .macOS(.v13),
    .iOS(.v16)
  ],
  products: [
    .library(
      name: "DayframeBackgroundExecutionCore",
      targets: ["DayframeBackgroundExecutionCore"]
    )
  ],
  targets: [
    .target(
      name: "DayframeBackgroundExecutionCore",
      path: "ios",
      exclude: [
        "DayframeBackgroundExecution.podspec",
        "DayframeBackgroundExecutionModule.swift",
        "DayframeBackgroundExecutionService.swift"
      ],
      sources: ["DayframeBackgroundExecutionCore.swift"]
    ),
    .testTarget(
      name: "DayframeBackgroundExecutionCoreTests",
      dependencies: ["DayframeBackgroundExecutionCore"],
      path: "Tests"
    )
  ]
)

