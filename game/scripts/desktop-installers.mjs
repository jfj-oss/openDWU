// Installers around a packaged app (scripts/package-desktop.mjs --installers; npm run dist:linux / dist:mac / dist:win).
// Everything goes to release/upload/, which the release workflow uploads as is: each installer plus a <file>.sha256.
//
//   Linux:   openDWU-<v>-linux-x64.AppImage   electron-builder (AppImage target) on the packaged folder
//            openDWU-<v>-linux-x64.tar.gz     GNU tar of the packaged folder (top folder openDWU-<v>-linux-x64/)
//   Windows: openDWU-<v>-windows-x64-setup.exe  electron-builder NSIS: per-user install (no admin), Start menu + desktop
//                                               shortcuts, uninstaller; installs over an older version in place
//            openDWU-<v>-windows-x64.zip      the packaged folder (portable; top folder openDWU-<v>-windows-x64/)
//   macOS:   openDWU-<v>-macos-arm64.dmg      hdiutil (macOS only): dwu.app + an Applications link + first-launch notes
//
// The packaged app comes from @electron/packager either way; electron-builder only wraps it (its --prepackaged mode),
// so the app tested by scripts/desktop-check.mjs is byte for byte the one inside the installers. electron-builder lives
// in scripts/installer-tools/ with its own lockfile, so `npm ci` for playing / developing does not pull it in; it is
// installed there on first use. Nothing is signed (no certificates); see RELEASING.md.
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assetFileNames } = require('../desktop/updateCheck.cjs');

const APP_ID = 'local.dwureup.dwu';

function sha256File(file) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.writeFileSync(`${file}.sha256`, `${hash}  ${path.basename(file)}\n`);
    return hash;
}

/** electron-builder from scripts/installer-tools (npm ci there on first use). */
function loadElectronBuilder(root) {
    const toolsDir = path.join(root, 'scripts', 'installer-tools');
    if (!fs.existsSync(path.join(toolsDir, 'node_modules', 'electron-builder'))) {
        console.log('Installing installer tools (scripts/installer-tools: npm ci)...');
        execSync('npm ci --no-audit --no-fund', { cwd: toolsDir, stdio: 'inherit' });
    }
    return createRequire(path.join(toolsDir, 'package.json'))('electron-builder');
}

/** Run electron-builder on the packaged folder; returns the produced files whose names are in `wanted`. */
async function electronBuilder({ root, platform, outDir, stageDir, electronVersion, config, targets, wanted }) {
    const builder = loadElectronBuilder(root);
    const ebOut = path.join(root, 'release', 'eb-out');
    fs.rmSync(ebOut, { recursive: true, force: true });
    const platformObj = platform === 'linux' ? builder.Platform.LINUX : builder.Platform.WINDOWS;
    await builder.build({
        targets: platformObj.createTarget(targets, builder.Arch.x64),
        prepackaged: outDir,
        projectDir: stageDir,
        publish: 'never',
        config: {
            appId: APP_ID,
            productName: 'openDWU',
            electronVersion,
            npmRebuild: false,
            directories: { output: ebOut },
            publish: null,
            ...config,
        },
    });
    const found = [];
    for (const name of wanted) {
        const f = path.join(ebOut, name);
        if (!fs.existsSync(f)) throw new Error(`electron-builder did not produce ${name} (in ${ebOut}: ${fs.readdirSync(ebOut).join(', ')})`);
        found.push(f);
    }
    return found;
}

/** First-launch notes inside the macOS disk image. */
function macReadme(version) {
    return `openDWU ${version} for macOS (Apple silicon)

1. Drag dwu.app onto the Applications folder.

2. First launch: this app is not signed with an Apple Developer ID, so macOS
   blocks a plain double-click ("dwu can't be opened" / "Apple could not verify").
   Open it once like this:
     - In Applications, Control-click (or right-click) dwu.app -> Open -> Open.
     - macOS 15 Sequoia and later: double-click it once, then open
       System Settings -> Privacy & Security, scroll down to the message about
       dwu, click "Open Anyway" and confirm.
   Or, in Terminal:
       xattr -dr com.apple.quarantine /Applications/dwu.app
   After that it opens normally.

3. openDWU reads the art, sounds and data of Distant Worlds: Universe from your
   own copy of the game; none of it is included. On first launch it asks for the
   folder. DW:U is a Windows game: install it with Steam inside Whisky or
   CrossOver, or copy the "Distant Worlds Universe" folder from a Windows PC to
   ~/Games/Distant Worlds Universe (found automatically).

Updates: the app checks GitHub for a new release once a day and offers the new
disk image; install it over this one (settings and saves are kept).
`;
}

function hdiutilCreate(args) {
    // hdiutil on GitHub's macOS runners fails now and then with "Resource busy": retry a few times.
    for (let attempt = 1; ; attempt++) {
        try {
            execFileSync('hdiutil', args, { stdio: 'inherit' });
            return;
        } catch (err) {
            if (attempt >= 4) throw err;
            console.warn(`hdiutil failed (attempt ${attempt}); retrying in ${attempt * 5} s`);
            execFileSync('sleep', [String(attempt * 5)]);
        }
    }
}

export async function makeInstallers({ root, platform, arch, version, outDir, stageDir, icons, electronVersion }) {
    const uploadDir = path.join(root, 'release', 'upload');
    fs.mkdirSync(uploadDir, { recursive: true });
    const names = assetFileNames(version);
    // Clear this platform's previous installers (any version); other platforms' files stay (local multi-platform runs).
    const mine = { linux: /-linux-x64\.(AppImage|tar\.gz)(\.sha256)?$/, win32: /-windows-x64(-setup\.exe|\.zip)(\.sha256)?$/, darwin: /-macos-arm64\.dmg(\.sha256)?$/ }[platform];
    for (const f of fs.readdirSync(uploadDir)) if (mine && mine.test(f)) fs.rmSync(path.join(uploadDir, f), { force: true });
    const files = [];

    if (platform === 'linux') {
        if (arch !== 'x64') throw new Error('Linux installers are built for x64 only');
        // tar.gz: the packaged folder under a versioned top folder.
        const tgz = path.join(uploadDir, names.linuxTarGz);
        const top = `openDWU-${version}-linux-x64`;
        execFileSync(
            'tar',
            ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mode=u+rwX,go+rX,go-w', `--transform=s,^${path.basename(outDir)},${top},`, '-C', path.dirname(outDir), '-czf', tgz, path.basename(outDir)],
            { stdio: 'inherit' },
        );
        files.push(tgz);
        // AppImage.
        const [appImage] = await electronBuilder({
            root,
            platform,
            outDir,
            stageDir,
            electronVersion,
            targets: ['AppImage'],
            wanted: [names.linuxAppImage],
            config: {
                executableName: 'dwu',
                linux: {
                    executableName: 'dwu',
                    icon: icons.png,
                    category: 'Game',
                    synopsis: 'A recreation of Distant Worlds: Universe',
                    description: 'openDWU, a recreation of Distant Worlds: Universe. Reads the game files from your own install.',
                    desktop: { entry: { Name: 'openDWU', Comment: 'A recreation of Distant Worlds: Universe', StartupWMClass: 'dwu', Categories: 'Game;StrategyGame;' } },
                },
                appImage: { artifactName: names.linuxAppImage },
            },
        });
        const dest = path.join(uploadDir, names.linuxAppImage);
        fs.copyFileSync(appImage, dest);
        fs.chmodSync(dest, 0o755);
        files.push(dest);
    } else if (platform === 'win32') {
        if (arch !== 'x64') throw new Error('Windows installers are built for x64 only');
        const [setup] = await electronBuilder({
            root,
            platform,
            outDir,
            stageDir,
            electronVersion,
            targets: ['nsis'],
            wanted: [names.winSetup],
            config: {
                executableName: 'dwu',
                win: { executableName: 'dwu', icon: icons.ico, signAndEditExecutable: false, verifyUpdateCodeSignature: false },
                nsis: {
                    artifactName: names.winSetup,
                    oneClick: false,
                    perMachine: false, // per-user: %LOCALAPPDATA%\Programs\openDWU, no administrator rights
                    allowToChangeInstallationDirectory: true,
                    createDesktopShortcut: true,
                    createStartMenuShortcut: true,
                    shortcutName: 'openDWU',
                    uninstallDisplayName: 'openDWU',
                    installerIcon: icons.ico,
                    uninstallerIcon: icons.ico,
                    deleteAppDataOnUninstall: false, // keeps config.json (game folder) and saves
                    runAfterFinish: true,
                },
            },
        });
        const dest = path.join(uploadDir, names.winSetup);
        fs.copyFileSync(setup, dest);
        files.push(dest);
        // Portable zip: the packaged folder under a versioned top folder.
        const zip = path.join(uploadDir, names.winZip);
        const top = `openDWU-${version}-windows-x64`;
        const zipStage = path.join(root, 'release', 'zip-stage');
        fs.rmSync(zipStage, { recursive: true, force: true });
        fs.mkdirSync(zipStage, { recursive: true });
        fs.cpSync(outDir, path.join(zipStage, top), { recursive: true, verbatimSymlinks: true });
        if (process.platform === 'win32') {
            // Windows' own bsdtar (System32, Windows 10+) writes zip with -a; Compress-Archive is far slower for 300 MB.
            // By full path: under Git Bash, PATH finds GNU tar first, which cannot write zip.
            const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
            execFileSync(bsdtar, ['-a', '-c', '-f', zip, '-C', zipStage, top], { stdio: 'inherit' });
        } else {
            execFileSync(process.env.SEVEN_ZIP || '7z', ['a', '-tzip', '-mx=7', zip, top], { cwd: zipStage, stdio: 'inherit' });
        }
        fs.rmSync(zipStage, { recursive: true, force: true });
        files.push(zip);
    } else if (platform === 'darwin') {
        if (process.platform !== 'darwin') throw new Error('The macOS disk image needs hdiutil: run `npm run dist:mac` on a Mac (or let the release workflow build it).');
        const dmgStage = path.join(root, 'release', 'dmg-stage');
        fs.rmSync(dmgStage, { recursive: true, force: true });
        fs.mkdirSync(dmgStage, { recursive: true });
        // ditto keeps the framework symlinks, extended attributes and the ad-hoc signature intact.
        execFileSync('ditto', [path.join(outDir, 'dwu.app'), path.join(dmgStage, 'dwu.app')], { stdio: 'inherit' });
        fs.symlinkSync('/Applications', path.join(dmgStage, 'Applications'));
        fs.writeFileSync(path.join(dmgStage, 'Read Me First.txt'), macReadme(version));
        const dmg = path.join(uploadDir, names.macDmg);
        hdiutilCreate(['create', '-volname', `openDWU ${version}`, '-srcfolder', dmgStage, '-fs', 'HFS+', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', dmg]);
        execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit' });
        fs.rmSync(dmgStage, { recursive: true, force: true });
        files.push(dmg);
    } else {
        throw new Error(`no installers for ${platform}`);
    }

    for (const f of files) console.log(`  ${path.basename(f)}  ${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB  sha256 ${sha256File(f)}`);
    return files;
}
