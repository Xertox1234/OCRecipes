# Our Xcode 26 / iOS 26 build fixes, run from the Podfile's post_install after
# react_native_post_install. `expo prebuild` regenerates ios/ (CNG), so these
# live here and plugins/ios-podfile-fixes.js inserts the require + call.
# Moved verbatim from the hand-edited ios/Podfile; `installer.sandbox.root` is
# ios/Pods, so the paths below still resolve from the repo root.
def ocrecipes_post_install(installer)
  # react_native_post_install's own updateOSDeploymentTarget floors every
  # pod target at RN's hardcoded min_ios_version_supported (15.1, still so
  # in RN 0.85) -- it takes max(RN's constant, the pod's own existing
  # setting) and does NOT consult this Podfile's `platform :ios` line above.
  # So raising the app's deployment target to 16.4 (Expo SDK 56's minimum,
  # set in app.json's expo-build-properties) leaves every pod still compiling at 15.1
  # unless swept again here. Same max-with-existing pattern, applied to
  # OUR floor instead of RN's.
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 16.4
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4'
      end
    end
  end

  # iOS 26 simulators are arm64-only but MLKit ships fat binaries with arm64
  # tagged for device. Strip EXCLUDED_ARCHS so xcodebuild discovers arm64
  # simulators, then re-tag MLKit binaries for simulator platform.
  installer.pods_project.build_configurations.each do |config|
    config.build_settings.delete('EXCLUDED_ARCHS[sdk=iphonesimulator*]')
  end
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings.delete('EXCLUDED_ARCHS[sdk=iphonesimulator*]')
    end
  end
  Dir.glob(File.join(installer.sandbox.root, 'Target Support Files', '**', '*.xcconfig')).each do |xcconfig_path|
    content = File.read(xcconfig_path)
    cleaned = content.gsub(/EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]\s*=\s*arm64\n?/, '')
    File.write(xcconfig_path, cleaned) if content != cleaned
  end

  # Add a pre-compile Run Script phase to OCRecipes that patches MLKit frameworks
  # for the current build platform — simulator needs arm64 tagged as iOS-simulator,
  # device needs arm64 tagged as iOS. This replaces the unconditional pod-install-time
  # patch so both simulator and device builds work without re-running pod install.
  script_path = File.join(installer.sandbox.root, '..', '..', 'scripts', 'patch-mlkit-simulator.py')
  if File.exist?(script_path)
    installer.aggregate_targets.each do |agg|
      next unless agg.name == 'Pods-OCRecipes'
      project = agg.user_project
      project.targets.each do |target|
        next unless target.name == 'OCRecipes'
        phase_name = '[MLKit] Patch for platform'
        next if target.build_phases.any? { |p| p.respond_to?(:name) && p.name == phase_name }
        phase = target.new_shell_script_build_phase(phase_name)
        # Declare the phase intentionally always-out-of-date so Xcode stops
        # warning about "ambiguous dependencies". This script genuinely must
        # run every build (it re-tags MLKit binaries per platform), so there
        # are no stable input/output files to declare instead.
        phase.always_out_of_date = "1"
        phase.shell_script = <<~SHELL
          SCRIPT="${SRCROOT}/../scripts/patch-mlkit-simulator.py"
          PODS="${SRCROOT}/Pods"
          if [ -f "$SCRIPT" ] && [ -d "$PODS" ]; then
            if [ "$PLATFORM_NAME" = "iphonesimulator" ]; then
              python3 "$SCRIPT" "$PODS"
            else
              python3 "$SCRIPT" --reverse "$PODS"
            fi
          fi
        SHELL
        # Move before Compile Sources so frameworks are correct before linking
        compile_idx = target.build_phases.index { |p| p.is_a?(Xcodeproj::Project::Object::PBXSourcesBuildPhase) }
        if compile_idx && compile_idx > 0
          target.build_phases.move_from(target.build_phases.index(phase), compile_idx)
        end
        project.save
      end
    end
  end

  # Swift 6.2 (Xcode 26) ICE with nitrogen-generated C++/Swift interop
  # (std::function capture, swiftlang/swift#76143). Manifests two ways:
  #  - whole-module batch ICE  -> SWIFT_COMPILATION_MODE = singlefile
  #  - LLVM optimizer crash in the Release archive ("Global is external, but
  #    doesn't have external or weak linkage" in the verify pass) -> -Onone
  # Local `expo run:ios` is Debug (-Onone) so it never hits the optimizer
  # crash; EAS's Release archive does. Apply to ALL VisionCamera-family
  # targets so the main VisionCamera lib (not just the barcode scanner) is
  # covered. Runtime cost is negligible — the heavy work is native AVFoundation.
  installer.pods_project.targets.each do |target|
    next unless target.name.start_with?('VisionCamera')
    target.build_configurations.each do |config|
      config.build_settings['SWIFT_COMPILATION_MODE'] = 'singlefile'
      config.build_settings['SWIFT_VERSION'] = '5'
      config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'
    end
  end
end
