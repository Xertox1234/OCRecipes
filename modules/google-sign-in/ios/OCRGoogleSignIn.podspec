Pod::Spec.new do |s|
  s.name           = 'OCRGoogleSignIn'
  s.version        = '1.0.0'
  s.summary        = 'OCRecipes bridge to Google Sign-In'
  s.description    = 'One function: Google sign-in with a server nonce.'
  s.license        = 'UNLICENSED'
  s.author         = 'OCRecipes'
  s.homepage       = 'https://ocrecipes.com'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleSignIn', '~> 10.0'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
