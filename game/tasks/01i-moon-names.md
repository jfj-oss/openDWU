# Task 01i — Moon names: port GenerateRandomNameAlt

thinking: off
scope: locked

Edit only `src/sim/galaxy.ts` and `test/galaxy.test.ts`. Replace the placeholder behind `TODO(port): GenerateRandomNameAlt` with a faithful port of the C# below (all helpers, every `Rnd` call in order; if a helper is already ported in galaxy.ts, reuse it). Start editing right away.

Tests: every moon has a non-empty name made of letters; names are deterministic for seed 1; the galaxy output for seed 1 is otherwise unchanged except moon names (compare star/planet counts and positions before/after).
`npm run typecheck` && `npm test`. Append `## Worker report`.

## C# — Galaxy.4.cs
```csharp
        public string GenerateMoonName(Habitat moon)
        {
            string text = GenerateCodeName();
            _ = moon.Parent;
            DetermineHabitatSystemStar(moon);
            return GenerateRandomNameAlt();
        }

        public string GenerateRandomName()
        {
            string text = string.Empty;
            string[] array = new string[6] { "a", "e", "i", "o", "u", "y" };
            string[] array2 = new string[21]
            {
            "b", "c", "d", "f", "g", "h", "j", "k", "l", "m",
            "n", "p", "q", "r", "s", "t", "v", "w", "x", "y",
            "z"
            };
            int num = 7;
            int num2 = Rnd.Next(2, 5);
            for (int i = 0; i < num2; i++)
            {
                int num3 = 0;
                int num4 = 0;
                switch (Rnd.Next(0, 4))
                {
                    case 0:
                        num3 = Rnd.Next(0, array2.Length);
                        text += array2[num3];
                        num4 = Rnd.Next(0, array.Length);
                        text += array[num4];
                        break;
                    case 1:
                        {
                            num4 = Rnd.Next(0, array.Length);
                            int iterationCount2 = 0;
                            while (ConditionCheckLimit(CheckForIllegalVowelCombination(text, array[num4]), 50, ref iterationCount2))
                            {
                                num4 = Rnd.Next(0, array.Length);
                            }
                            text += array[num4];
                            num3 = Rnd.Next(0, array2.Length);
                            text += array2[num3];
                            break;
                        }
                    case 2:
                        num3 = Rnd.Next(0, array2.Length);
                        text += array2[num3];
                        num4 = Rnd.Next(0, array.Length);
                        text += array[num4];
                        num3 = Rnd.Next(0, array2.Length);
                        text += array2[num3];
                        break;
                    case 3:
                        {
                            num4 = Rnd.Next(0, array.Length);
                            int iterationCount = 0;
                            while (ConditionCheckLimit(CheckForIllegalVowelCombination(text, array[num4]), 50, ref iterationCount))
                            {
                                num4 = Rnd.Next(0, array.Length);
                            }
                            text += array[num4];
                            num3 = Rnd.Next(0, array2.Length);
                            text += array2[num3];
                            num4 = Rnd.Next(0, array.Length);
                            text += array[num4];
                            break;
                        }
                }
                if (text.Length > num)
                {
                    break;
                }
            }
            return text.Substring(0, 1).ToUpper(CultureInfo.InvariantCulture) + text.Substring(1, text.Length - 1);
        }

        private string GenerateRandomNameAlt()
        {
            string text = string.Empty;
            int num = Rnd.Next(4, 9);
            int num2 = Rnd.Next(0, 2);
            int num3 = 0;
            int num4 = 0;
            int iterationCount = 0;
            while (ConditionCheckLimit(text.Length < num, 50, ref iterationCount))
            {
                switch (num2)
                {
                    case 0:
                        if (Rnd.Next(0, 2) == 0 && text.Length > 0 && num3 == 0)
                        {
                            text = ((text.Length < num - 2) ? AddVowelCombination(text) : AddVowelCombinationEnd(text));
                            num3++;
                        }
                        else
                        {
                            text = AddVowel(text);
                        }
                        num2 = 1;
                        break;
                    case 1:
                        if (Rnd.Next(0, 2) != 0 || num4 != 0)
                        {
                            text = ((text.Length < num - 1) ? AddConsonant(text) : AddConsonantEnd(text));
                        }
                        else
                        {
                            text = ((text.Length <= 0) ? AddConsonantCombinationStart(text) : ((text.Length < num - 2) ? AddConsonantCombination(text) : AddConsonantCombinationEnd(text)));
                            num4++;
                        }
                        num2 = 0;
                        break;
                }
            }
            return text.Substring(0, 1).ToUpper(CultureInfo.InvariantCulture) + text.Substring(1, text.Length - 1);
        }

        private string AddVowel(string word)
        {
            string[] array = new string[12]
            {
            "a", "a", "a", "e", "e", "e", "e", "i", "i", "o",
            "o", "u"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddVowelEnd(string word)
        {
            string[] array = new string[6] { "a", "a", "o", "o", "u", "y" };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddVowelCombination(string word)
        {
            string[] array = new string[12]
            {
            "ai", "au", "ea", "ee", "ei", "eu", "ey", "oa", "oi", "oo",
            "ou", "ui"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddVowelCombinationEnd(string word)
        {
            string[] array = new string[10] { "ai", "au", "ea", "eu", "ie", "oa", "oi", "oo", "oy", "ui" };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddConsonant(string word)
        {
            string[] array = new string[65]
            {
            "b", "b", "c", "c", "c", "d", "d", "d", "d", "f",
            "f", "g", "g", "h", "h", "h", "h", "h", "h", "j",
            "k", "l", "l", "l", "l", "m", "m", "m", "n", "n",
            "n", "n", "n", "n", "n", "p", "p", "r", "r", "r",
            "r", "r", "r", "s", "s", "s", "s", "s", "s", "t",
            "t", "t", "t", "t", "t", "t", "t", "t", "v", "w",
            "w", "x", "y", "y", "z"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddConsonantEnd(string word)
        {
            string[] array = new string[35]
            {
            "b", "d", "d", "d", "d", "d", "f", "f", "g", "k",
            "l", "l", "m", "n", "n", "n", "n", "p", "r", "r",
            "r", "s", "s", "s", "s", "s", "s", "s", "t", "t",
            "t", "t", "v", "x", "z"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddConsonantCombinationStart(string word)
        {
            string[] array = new string[29]
            {
            "bl", "br", "ch", "cl", "cr", "dr", "fl", "fr", "gh", "gl",
            "gr", "kl", "kr", "ph", "pl", "pr", "qu", "rh", "ry", "sc",
            "sh", "sk", "sl", "sm", "sn", "sp", "st", "th", "tr"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddConsonantCombinationEnd(string word)
        {
            string[] array = new string[36]
            {
            "ff", "gh", "ld", "lf", "lg", "lk", "ll", "lm", "lt", "ms",
            "nc", "nd", "ng", "nk", "ns", "nt", "ny", "ph", "rc", "rd",
            "rf", "rg", "rk", "rl", "rm", "rn", "rp", "rs", "rt", "ry",
            "sc", "sh", "sk", "ss", "st", "th"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

        private string AddConsonantCombination(string word)
        {
            string[] array = new string[73]
            {
            "bb", "bl", "br", "ch", "cl", "cr", "dd", "dr", "ff", "fl",
            "fr", "gg", "gl", "gr", "kl", "kr", "lc", "ld", "lf", "lg",
            "lk", "ll", "lm", "ln", "lp", "ls", "lt", "mb", "mm", "mn",
            "mp", "ms", "nc", "nd", "ng", "nk", "nn", "ns", "nt", "ph",
            "pl", "pp", "pr", "ps", "qu", "rb", "rc", "rd", "rf", "rg",
            "rh", "rk", "rl", "rm", "rn", "rp", "rr", "rs", "rt", "ry",
            "sc", "sh", "sk", "sl", "sm", "sn", "sp", "ss", "st", "th",
            "tr", "wl", "xx"
            };
            int num = Rnd.Next(0, array.Length);
            word += array[num];
            return word;
        }

```
