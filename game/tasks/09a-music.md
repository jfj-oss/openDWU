# Task 09a — Music player

thinking: off
scope: locked

Everything you need is below. Create `src/audio/musicPlayer.ts` and `test/musicPlayer.test.ts`; minimal wiring in `src/main.ts` **only** as a single `startMusic()` call after the main menu is shown (one line + import). Start editing right away.

Port `MusicPlayer.cs` + `MusicMood` to TypeScript on the Web Audio API / `HTMLAudioElement`:
- Same mood → track selection rules, fade in/out timings and volume handling as the C#; track files are served from `/assets/dwu/Sounds/Music/<file>` (list below).
- Browsers block autoplay until a user gesture: start playback on the first pointerdown/keydown after `startMusic()`.
- Expose `setMood(mood)`, `setVolume(0..1)`, `mute()`, `unmute()`.
- Pure helpers (selection by mood, fade curve) unit-tested; no audio in tests.

`npm run typecheck` && `npm test`. Append `## Worker report`.

## Files in Sounds/Music/
Action1.mp3, Action2.mp3, BoldStroke.mp3, Desperate.mp3, DistantWorldsTheme.mp3, DistantWorldsTheme_Legends.mp3, DistantWorldsTheme_Original.mp3, DistantWorldsTheme_ROTS.mp3, Forceful.mp3, Frustrated.mp3, Gripping.mp3, Intensity.mp3, OnTrack.mp3, Outlaw.mp3, Pursuit.mp3, Shadows.mp3, Shock.mp3, Strike.mp3, Striving.mp3, Suspense.mp3, Utopia.mp3

## MusicMood.cs
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.MusicMood
// Assembly: DistantWorlds.Types, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: C87DBA0E-BD3A-46BA-A8F0-EE9F5E5721E2
// Assembly location: H:\7\DistantWorlds.Types.dll

using System;

namespace DistantWorlds.Types
{
  [Serializable]
  public enum MusicMood
  {
    Undefined,
    Quiet,
    Moderate,
    Intense,
    Theme,
  }
}
```

## MusicPlayer.cs
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.MusicPlayer
// Assembly: DistantWorlds, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: DFB67E2D-B390-4FC8-9690-CA3C0824704F
// Assembly location: F:\SteamLibrary\steamapps\common\Distant Worlds Universe\DistantWorlds - Copy-Unpacked.exe

using DistantWorlds.Types;
using System;
using System.IO;
using System.Timers;
using Microsoft.Xna.Framework.Media;

namespace DistantWorlds
{
    public class MusicPlayer
    {
        public delegate void SetVolumeDelegate(double volume);

        public delegate void StopDelegate();

        public delegate void PauseDelegate();

        public delegate void ResumeDelegate();

        public delegate void PlayMusicDelegate();

        public delegate void PlayMusicFileDelegate(string filePath);

        public delegate void SetFadeVolumeDelegate(double volume);

        public delegate void StartThemeDelegate();

        public SetVolumeDelegate VolumeDelegate;

        public StopDelegate StopMethodDelegate;

        public PauseDelegate PauseMethodDelegate;

        public ResumeDelegate ResumeMethodDelegate;

        public PlayMusicDelegate PlayMusicMethodDelegate;

        public PlayMusicFileDelegate PlayMusicFileMethodDelegate;

        public SetFadeVolumeDelegate FadeVolumeDelegate;

        public StartThemeDelegate StartThemeMethodDelegate;

        private Main main_0;

        private string string_0;

        private string string_1;

        private string string_2;

        private string[] string_3;

        private Timer timer_0;

        private double double_0;

        private double double_1;

        private int int_0;

        private MusicFadeFinishAction musicFadeFinishAction_0;

        private double double_2;

        private double double_3;

        private bool bool_0;

        private Random random_0;

        public bool IsPlaying
        {
            get
            {
                if (MediaPlayer.PlayPosition.TotalSeconds > 0.0)
                {
                    return true;
                }
                return false;
            }
        }

        public bool IsInitiatingFade => bool_0;

        public double Volume => double_2;
        public double ActualVolume => MediaPlayer.Volume;

        ~MusicPlayer()
        {
            timer_0.Stop();
        }

        public MusicPlayer(Main mainForm, string folder, string themeMusic):base()
        {
            
            double_0 = -1.0;
            double_1 = 0.02;
            main_0 = mainForm;
            string_1 = themeMusic;
            string_2 = folder;
            string_3 = Directory.GetFiles(folder, "*.mp3");
            if (string_3 != null && string_3.Length != 0)
            {
                if (!File.Exists(string_2 + string_1))
                {
                    throw new ApplicationException("Music folder does not contain Theme music: " + string_1);
                }
                random_0 = new Random((int)DateTime.Now.Ticks);
                timer_0 = new Timer();
                timer_0.Interval = 50.0;
                timer_0.Elapsed += timer_0_Elapsed;
                timer_0.Stop();
                StartThemeMethodDelegate = StartThemeInternal;
                VolumeDelegate = SetVolume;
                StopMethodDelegate = Stop;
                PauseMethodDelegate = Pause;
                ResumeMethodDelegate = ResumeMusic;
                PlayMusicMethodDelegate = method_1;
                PlayMusicFileMethodDelegate = method_0;
                FadeVolumeDelegate = SetFadeVolume;
                return;
            }
            throw new ApplicationException("Music folder does not contain any MP3 files");
        }

        public void Start()
        {
            MediaPlayer.MediaStateChanged += mediaPlayer_0_MediaEnded;
            string_0 = EbsZqjqvhZ();
            method_1();
        }

        public void Stop()
        {
            MediaPlayer.MediaStateChanged -= mediaPlayer_0_MediaEnded;
            MediaPlayer.Stop();
        }

        public void Pause()
        {
            MediaPlayer.Pause();
        }

        public void StartTheme()
        {
            main_0.Invoke(StartThemeMethodDelegate);
        }

        public void StartThemeInternal()
        {
            MediaPlayer.MediaStateChanged += mediaPlayer_0_MediaEnded;
            string_0 = string_2 + string_1;
            method_1();
        }

        public void SetFadeVolume(double volume)
        {
            if (volume >= 0.0 && volume <= 1.0)
            {
                MediaPlayer.Volume = (float)(volume * 0.6);
            }
        }

        public void SetVolume(double volume)
        {
            if (volume >= 0.0 && volume <= 1.0)
            {
                double_2 = volume;
                MediaPlayer.Volume = (float)(double_2 * 0.6);
            }
        }

        public void SetVolume(SoundVolume volume)
        {
            switch (volume)
            {
                case SoundVolume.Mute:
                    double_2 = 0.0;
                    break;
                case SoundVolume.Faint:
                    double_2 = 0.1;
                    break;
                case SoundVolume.Soft:
                    double_2 = 0.3;
                    break;
                case SoundVolume.Normal:
                    double_2 = 0.5;
                    break;
                case SoundVolume.Loud:
                    double_2 = 0.75;
                    break;
                case SoundVolume.Maximum:
                    double_2 = 1.0;
                    break;
            }
            main_0.Invoke(VolumeDelegate, double_2);
        }

        private void mediaPlayer_0_MediaEnded(object sender, EventArgs e) {
            if (MediaPlayer.State != MediaState.Stopped)
                return;

            string_0 = EbsZqjqvhZ();
            method_1();
        }

        public void ResumeMusic()
        {
            bool_0 = false;
            MediaPlayer.Resume();
        }

        private void method_0(string string_4)
        {
            bool_0 = false;
            var songName = "<unknown>";
            try {
                songName = Path.GetFileNameWithoutExtension(string_4);
            }
            catch {
                // oh well
            }
            MediaPlayer.Play(Song.FromUri(songName, new Uri(string_4)));
            SetVolume(double_2);
            //MediaPlayer.Play();
        }

        private void method_1()
        {
            bool_0 = false;
            string string_ = string_0;
            method_0(string_);
        }

        public void FadeResume()
        {
            bool_0 = false;
            double_3 = 0.0;
            double_0 = 1.0;
            musicFadeFinishAction_0 = MusicFadeFinishAction.Resume;
            MediaPlayer.Volume = 0.0f;
            MediaPlayer.Resume();
            timer_0.Start();
        }

        public void FadePause()
        {
            bool_0 = true;
            double_3 = double_2;
            double_0 = -1.0;
            musicFadeFinishAction_0 = MusicFadeFinishAction.Pause;
            timer_0.Start();
        }

        public void FadeStop()
        {
            bool_0 = true;
            double_3 = double_2;
            double_0 = -1.0;
            musicFadeFinishAction_0 = MusicFadeFinishAction.Stop;
            timer_0.Start();
        }

        public void ForceSwitch()
        {
            double_3 = double_2;
            double_0 = -1.0;
            musicFadeFinishAction_0 = MusicFadeFinishAction.StartNewMusic;
            timer_0.Start();
        }

        private void timer_0_Elapsed(object sender, ElapsedEventArgs e)
        {
            double num = double_3;
            double val = Math.Sqrt(double_3 + 0.1) * double_1;
            val = Math.Max(0.005, val);
            num += double_0 * val;
            bool flag = false;
            double num2 = 0.0;
            if (double_0 > 0.0)
            {
                num2 = double_2;
                if (num >= num2)
                {
                    flag = true;
                    num = num2;
                }
            }
            else if (num <= num2)
            {
                flag = true;
                num = num2;
            }
            if (flag)
            {
                bool_0 = false;
                int_0++;
                if (int_0 > 20)
                {
                    int_0 = 0;
                    switch (musicFadeFinishAction_0)
                    {
                        case MusicFadeFinishAction.StartNewMusic:
                            string_0 = EbsZqjqvhZ();
                            main_0.Invoke(PlayMusicMethodDelegate);
                            main_0.Invoke(VolumeDelegate, double_2);
                            break;
                        case MusicFadeFinishAction.Stop:
                            main_0.Invoke(StopMethodDelegate);
                            break;
                        case MusicFadeFinishAction.Pause:
                            main_0.Invoke(PauseMethodDelegate);
                            break;
                    }
                    musicFadeFinishAction_0 = MusicFadeFinishAction.StartNewMusic;
                    timer_0.Stop();
                    return;
                }
            }
            double_3 = num;
            main_0.BeginInvoke(FadeVolumeDelegate, double_3);
        }

        private string EbsZqjqvhZ()
        {
            string text = string_0;
            while (string.IsNullOrEmpty(text) || (string_3.Length > 1 && text == string_0))
            {
                int num = random_0.Next(0, string_3.Length);
                text = string_3[num];
            }
            return text;
        }
    }
}
```
