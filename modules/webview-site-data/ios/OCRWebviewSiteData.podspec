Pod::Spec.new do |s|
  s.name           = 'OCRWebviewSiteData'
  s.version        = '1.0.0'
  s.summary        = 'OCRecipes WebView site-data clear'
  s.description    = 'One function: clear the default WKWebsiteDataStore.'
  s.license        = 'UNLICENSED'
  s.author         = 'OCRecipes'
  s.homepage       = 'https://ocrecipes.com'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
