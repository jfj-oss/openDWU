### Race-to-Race bias matrix (raceBiases.txt; row feels towards column; range -50..+50)

       Ketarov        Atuuk     Gizurean       Dhayut        Human      Quameno     Mortalen    Ackdarian    Haakonish    Naxxilian        Zenox       Teekan     Wekkarus      Boskara      Shandar       Ugnari      Kiadian       Sluken      Securan       Ikkuro     Shakturi    Mechanoid
Ketarov                  10           10            0            0            0            0            0            0            0            0            5            5            0            0            0            5            0            0            0           10            0            0
Atuuk                    10           10            0            0            0            0            0            0            0            0            5            5            0            0            0            5            0            0            0           10            0            0
Gizurean                  0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Dhayut                    0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Human                     0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0
Quameno                   0            0          -10          -10            0           10            0           10            0            0            0            0           10          -10            0            0            0          -10            0            0          -10            0
Mortalen                  0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Ackdarian                 0            0          -10          -10            0           10            0           10            0            0            0            0           10          -10            0            0            0          -10            0            0          -10            0
Haakonish                 0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Naxxilian                 0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Zenox                     0            0          -15          -10            0            0            0            0            0            0           10           10            0          -15            0           10            0          -15            0            0          -15            0
Teekan                    0            0          -10          -10            0            0            0            0            0            0           10           10            0          -10            0           10            0          -10            0            0          -10            0
Wekkarus                  0            0          -10          -10            0           10            0           10            0            0            0            0           10          -10            0            0            0          -10            0            0          -10            0
Boskara                   0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Shandar                   0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Ugnari                    0            0          -10          -10            0            0            0            0            0            0           10           10            0          -10            0           10            0          -10            0            0          -10            0
Kiadian                   0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0
Sluken                    0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Securan                   0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0
Ikkuro                   10           10            0            0            0            0            0            0            0            0            5            5            0            0            0            5            0            0            0           10            0            0
Shakturi                  0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Mechanoid                 0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0

### Race-family bias matrix (raceFamilyBiases.txt; range -30..+30)

      Humanoid     Ursidian    Insectoid    Reptilian    Amphibian       Rodent      Machine
Humanoid                 10            0          -10            0            0            0            0
Ursidian                  0           10            0            0            0            5            0
Insectoid               -10            0           10            5          -10          -10          -10
Reptilian                 0            0            5           10            5            0            0
Amphibian                 0            0          -10            0           10            0            0
Rodent                    0            0          -10            0            0           10            0
Machine                  10            0          -10            0            0            0            0

### Governments (governments.txt; each attribute is a multiplier vs 1.0=normal, range 0-3 unless noted)

ID  Name                      Corruption WarWear Maint ApprPop PopGrow ResSpeed TroopRec TradeBonus LeadRepl LeadDisrup LeadBoost LeadPool LeadManner Stability OwnRepConcern OtherRepImport SpecialFn Availability  NameAdjectives / NameNouns
 0  Despotism              1.1  0.65  0.85  0.95   1.0  0.75   1.2   1.0   0.2   1.3     0     0     1   0.9   1.0  0.25     0     0  | Great Grand    Empire Union Territory Supremacy Authority Sovereignty Hegemony
 1  Feudalism              1.0   0.8   0.9   0.9   1.0  0.75   1.4   1.0   0.3   1.6     0     1     1   1.3   1.0  0.75     0     0  | United Combined    Empire Alliance Union Group Federation Enclave Confederacy Council Colonies Alignment
 2  Monarchy               1.0   0.7   1.0   1.0   1.0   1.0  1.25   1.0   0.5   0.4     0     1     1   1.2   1.0   1.0     0     0  | Imperial Royal Great   Dominion Kingdom Realm Commonwealth Domain Dynasty
 3  Republic              0.85   1.2   1.1   1.0   1.0  1.25   1.0  1.05   1.0     0   1.0     0     2   2.0   1.0  0.75     0     0  | Free United Combined Imperial Great Empire Republic Alliance Territory Nation Federation Confederacy Coalition
 4  Democracy             0.85   1.4   1.2   1.2   1.1  1.25  0.75   1.1   1.0     0   1.0     0     2   1.8   1.0  0.75     0     0  | Free United Combined Great Grand Empire Republic Alliance Territory Federation Confederacy Coalition Colonies
 5  Military Dictatorship  1.0   0.5  0.85   0.8   1.0   1.0   1.3   1.0  0.25   1.5     0     2     1   0.7   1.0  0.25     0     0  | Imperial Great Grand   Empire Territory Nation Supremacy Authority Sovereignty Hegemony
 6  Way of the Ancients    0.8   1.0   0.9   1.3  1.15   1.5   1.0   1.1   1.0     0   1.0     0     2   2.0   0.2   1.2     0     2  |      
 7  Way of Darkness        1.0   0.2   0.7   1.0   1.1   1.3   1.5   1.0  0.35   0.2     0     2     1   1.6   0.1  0.25     0     3  |      
 8  Technocracy           0.85   1.0   1.1   1.0   1.0   1.5   0.9   1.0   0.3   0.7     0     3     0   1.3   1.0  0.75     0     1  | United     Empire Technocracy Ascendancy
 9  Mercantile Guild       1.0   1.0   0.9   1.0   1.0   1.0   0.9   1.3   1.0     0   1.0     0     2   1.5   1.0  0.25     0     1  | Free     Syndicate Consortium Corporation Industries Guilds
10  Utopian Paradise       1.0  1.75   1.5   1.3   1.2   1.0   0.5   1.0   1.0     0   1.5     0     2   1.0   1.0  0.25     0     1  | Free     Utopia Harmony Paradise Renaissance
11  Hive Mind              0.8   0.6  0.95   1.1   1.0   1.0   1.0   1.0  0.15   0.5     0     0     0   2.2   1.0   1.0     0     1  | Great     Hive Collective Conformity Consciousness
12  Corporate Nationalism 1.15  0.75   1.1   1.0  0.95   0.9  1.25   0.9   0.5   0.8     0     1     1   1.0   1.0   1.0     1     1  |      

Attribute order: 1=Corruption, 2=WarWearinessRate, 3=MaintenanceCosts, 4=ApprovalRating, 5=PopulationGrowth, 6=ResearchSpeed, 7=TroopRecruitment, 8=TradeBonus, 9=LeaderReplacementLikeliness, 10=LeaderReplacementDisruption, 11=LeaderReplacementBoost, 12=LeaderReplacementCharacterPool(0=None,1=Governors,2=Admirals/Generals,3=Scientists), 13=LeaderReplacementManner(0=replacement,1=coup,2=election), 14=Stability, 15=OwnReputationConcern(0-2), 16=OtherEmpireReputationImportance(0-2), 17=SpecialFunctionCode(0=None,1=NationalizePrivateSector), 18=Availability(0=all,1=race-specific,2=ancient guardians,3=shakturi)

### Government-to-Government bias matrix (governmentBiases.txt; range -30..+30)

     Despotism    Feudalism     Monarchy     Republic    Democracy Military Dic Way of the A Way of Darkn  Technocracy Mercantile G Utopian Para    Hive Mind Corporate Na
Despotism                      7            0            5            0          -10           11            0           16            0           -5            0            0            5
Feudalism                      0           11           13            7            4            0           12            0            0            6            0            0            0
Monarchy                       4           12           11            2            8           -7           12            0            0            0            0           -6            0
Republic                      -5            7            1           12           12          -12           19           -4            0            6            6            0           -2
Democracy                     -8            0            7           12           12          -14           20           -5            0            6           12            0           -4
Military Dictatorship          13            0            0          -14          -17            6           -5           22            0           -6          -12            0           12
Way of the Ancients          -10            0            7           16           17          -20           18          -30            0            6           14          -12          -12
Way of Darkness               16            0            0          -19          -22           18          -30           -8            0            0          -16            0           13
Technocracy                    0            0            0            4            6            0           10            0            8            2            6            0            0
Mercantile Guild              -6            6            0            7           12          -11           12          -15            6            8            6            0          -12
Utopian Paradise              -8            0            0            6            8          -12           12          -16            0            0           12          -10           -6
Hive Mind                      6            0            8           -7          -12           12            0           18            0           -5            0           24            0
Corporate Nationalism           7            0            4            0          -10           11           -6           16            0          -10            0            0            8
