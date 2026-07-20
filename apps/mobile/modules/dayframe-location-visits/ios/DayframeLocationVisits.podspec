require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'DayframeLocationVisits'
  s.version          = package['version']
  s.summary          = package['description']
  s.description      = package['description']
  s.license          = { :type => 'UNLICENSED' }
  s.author           = 'Dayframe'
  s.homepage         = 'https://github.com/kwabiwe/dayframe'
  s.platforms        = { :ios => '16.4' }
  s.source           = { :git => 'https://github.com/kwabiwe/dayframe.git' }
  s.static_framework = true
  s.swift_version    = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreLocation'
  s.source_files = '**/*.swift'
  s.exclude_files = 'Tests/**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
