let beneosTokens = {
    "001_vampire_beast": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3550, "s": 1.3},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.3},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1900, "s": 1.5},
            "Scything Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1900, "s": 1.5},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "001 The Primal Vampire Spawn",
            "variants": {}
        },
    },
    "002_glutony": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Devour": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 4000, "s": 1},
            "Vomit Bombard": {"fx": ["BFXShadow"], "a": "special", "t": 4600, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "002 Gluttony",
            "variants": {}
        },
    },
    "003_female_knight_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.3},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "003 Inquisitorial Penitent",
            "variants": {}
        },
    },
    "003_female_knight_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.3},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.3},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
        },
        "config": {
            "scalefactor": 2,
            "compendium": "003 Inquisitorial Penitent",
            "variants": {}
        },
    },
    "004_undead_centipede": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1200, "s": 1},
            "Pincers": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special", "t": 5000, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "004 Curseweaver",
            "variants": {}
        },
    },
    "005_assassin_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1.12},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.12},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Assassin's Dagger": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "005 Assassin",
            "variants": {}
        },
    },
    "005_assassin_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Assassin's Dagger": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "005 Assassin",
            "variants": {}
        },
    },
    "006_shield_guardian_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1600, "s": 1.2},
            "dead": {"fx": ["BFXShadow", "BFXDeadElectric"], "a": "dead", "t": 1, "s": 1.2},
            "Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 800, "s": 1},
            "Magna-Rail Punch (Recharge 5-6).": {
                "actionType": "attack",
                "fx": ["BFXShadow"],
                "a": "attack",
                "t": 2400,
                "s": 1
            },
        },
        "config": {
            "scalefactor": 1,
            "compendium": "006 Polarized Shield Guardian",
            "variants": {}
        },
    },
    "006_shield_guardian_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1600, "s": 1.2},
            "dead": {"fx": ["BFXShadow", "BFXDeadElectric"], "a": "dead", "t": 1, "s": 1.2},
            "Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 800, "s": 1},
            "Magna-Rail Punch (Recharge 5-6).": {
                "actionType": "attack",
                "fx": ["BFXShadow"],
                "a": "attack",
                "t": 2400,
                "s": 1
            },
        },
        "config": {
            "scalefactor": 1,
            "compendium": "006 Polarized Shield Guardian",
            "variants": {}
        },
    },
    "007_umber_spinner": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2300, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "007 Umber Spinner",
            "variants": {}
        },
    },
    "008_aspect_of_gluttony": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "008 Aspect of Gluttony",
            "variants": {}
        },
    },
    "009_skeleton_henchman_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 3000, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "Jagged Shortsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "009 Skeleton Henchman",
            "variants": {}
        },
    },
    "009_skeleton_henchman_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 3000, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "Jagged Shortsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "009 Skeleton Henchman",
            "variants": {}
        },
    },
    "009_skeleton_henchman_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 3000, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "Jagged Shortsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "009 Skeleton Henchman",
            "variants": {}
        },
    },
    "009_skeleton_henchman_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 3000, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "Jagged Shortsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "009 Skeleton Henchman",
            "variants": {}
        },
    },
    "009_skeleton_henchman_5": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 3000, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "Jagged Shortsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "009 Skeleton Henchman",
            "variants": {}
        },
    },
    "009_skeleton_henchman_6": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 3000, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "Jagged Shortsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "009 Skeleton Henchman",
            "variants": {}
        },
    },
    "010_horse_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_5": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_6": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_7": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_8": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_9": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_10": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_11": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_12": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "010_horse_13": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 900, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1400, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 200, "s": 1.2},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "010 Horse",
            "variants": {}
        },
    },
    "011_trained_fighter": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Longsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2000, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "011 Trained Fighter",
            "variants": {}
        },
    },
    "012_cipactli": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 5800, "s": 1.25},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 6500, "s": 1.25},
            "move": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "012 Cipactli",
            "variants": {}
        },
    },
    "013_harpyia": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.7},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.7},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4800, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Talons": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 4500, "s": 1},
        },
        "config": {
            "scalefactor": 1.7,
            "compendium": "013 Harpyia",
            "variants": {}
        },
    },
    "014_dragon": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.8},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.8},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 6000, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.8},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 7000, "s": 1.8},
            "Fire Breath (Recharge 6)": {"actionType":"saves","fx": ["BFXShadow"], "a": "special", "t": 7000, "s": 1.8},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "014 Dragon",
            "variants": {
                "Red Dragon": ["DragonRedVariant"],
                "Blue Dragon": ["DragonBlueVariant"],
                "Green Dragon": ["DragonGreenVariant"],
                "Black Dragon": ["DragonBlackVariant"],
                "White Dragon": ["DragonWhiteVariant"],
                "White Dragon 2": ["DragonWhiteVariant2"],
                "Brass Dragon": ["DragonBrassVariant"],
                "Copper Dragon": ["DragonCopperVariant"],
                "Bronze Dragon": ["DragonBronzeVariant"],
                "Gold Dragon": ["DragonGoldVariant"],
                "Silver Dragon": ["DragonSilverVariant"],
                "Shadow Dragon": ["DragonShadowVariant"]
            },
        },
    },
    "015_werewolf_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1.2, "s": 1.2},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 6000, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.8},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 6000, "s": 1.8},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "015 Werewolf (Wulfen)",
            "variants": {}
        },
    },
    "015_werewolf_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1.2, "s": 1.2},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 6000, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.8},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 6000, "s": 1.8},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "015 Werewolf (Wulfen)",
            "variants": {}
        },
    },
    "015_werewolf_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1.2, "s": 1.2},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 6000, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.8},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 6000, "s": 1.8},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "015 Werewolf (Wulfen)",
            "variants": {}
        },
    },
    "016_wolf_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "[Action] Bite": {"fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "015 Wolfkin",
            "variants": {}
        },
    },
    "016_wolf_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "[Action] Bite": {"fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "016 Lone Wolf",
            "variants": {}
        },
    },
    "016_wolf_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "[Action] Bite": {"fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "016 Wolf 1",
            "variants": {}
        },
    },
    "016_wolf_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4000, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "[Action] Bite": {"fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "016 Wolf 2",
            "variants": {}
        },
    },
    "017_dwarven_king": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4200, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "[Action] Mastercrafted Runic Battleaxe": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 5000, "s": 1.6}
        },
        "config": {
            "scalefactor": 1,
            "compendium": "",
            "variants": {}
        },
    },
    "018_giant_spider_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_5": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_6": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_7": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "018_giant_spider_8": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 1500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Impaling Legs": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3000, "s": 1.25},
            "It's getting sticky!": {"fx": ["BFXShadow"], "a": "special", "t": 6200, "s": 1.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "018 Giant Spider",
            "variants": {}
        },
    },
    "019_reef_keeper": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3500, "s": 1.2},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadYellowBlood"], "a": "dead", "t": 1, "s": 1.2},
            "Bioelectrical Spike": {"actionType": "other", "fx": ["BFXShadow", "BFXDeadElectric"], "a": "attack", "t": 3000, "s": 1.25},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "019 Reef Keeper",
            "variants": {}
        },
    },
    "020_grimgheist": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.3},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1.3},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4000, "s": 2},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "[Attack] Soulshatter Maul": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 4500, "s": 2.7},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "020 Grimgheist",
            "variants": {}
        },
    },
    "021_ghoul_wretchling": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4000, "s": 1},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Burrowing Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 4200, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "021 Ghoul Wretchling",
            "variants": {}
        },
    },
    "022_orc_shaman": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2000, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Brutal Cleaver": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3800, "s": 1},
            "Brutal Clever": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3800, "s": 1},
            "[Action] Invoke Primal Fury": {"fx": ["BFXRedGlow"], "a": "special", "t": 4200, "s": 1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "022 Orc Shaman",
            "variants": {}
        },
    },
    "023_orc_warchief": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 2208, "s": 1.26},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.26},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "Skullcrusher Greataxe": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3441, "s": 1.8},
            "Linebreaker Greatcleaver": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3441, "s": 1.8},
            "[Savage Onrush] Linebreaker Greatcleaver": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3441, "s": 1.8},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "023 Orc Warchief",
            "variants": {}
        },
    },
    "024_kentauros": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3083, "s": 1.5},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Skychaser Lance": {"fx": ["BFXShadow"], "a": "attack", "t": 958, "s": 1.6},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "024 Kentauros",
            "variants": {}
        },
    },
    "025_trained_archer_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.4},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1.4, "s": 1.4},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.4},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 5041, "s": 1.50},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
            "Longbow": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2666, "s": 1.60},
            "[Melee] Handaxe": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special", "t": 1874, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "025 Trained Archer 1",
            "variants": {}
        },
    },
    "025_trained_archer_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.4},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1.4, "s": 1.4},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.4},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 5041, "s": 1.50},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
            "Longbow": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2666, "s": 1.60},
            "[Melee] Handaxe": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special", "t": 1874, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "025 Trained Archer 2",
            "variants": {}
        },
    },
    "025_trained_archer_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.4},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1.4, "s": 1.4},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.4},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 5041, "s": 1.50},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
            "Longbow": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2666, "s": 1.60},
            "[Melee] Handaxe": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special", "t": 1874, "s": 1.3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "025 Trained Archer 3",
            "variants": {}
        },
    },
    "026_vampire_spawn_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3708, "s": 1.7},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.7},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3583, "s": 1.42},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 8583, "s": 1.83},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "026 Vampire Spawn 1",
            "variants": {}
        },
    },
    "026_vampire_spawn_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3708, "s": 1.7},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.7},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3583, "s": 1.42},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 8583, "s": 1.83},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "026 Vampire Spawn 2",
            "variants": {}
        },
    },
    "026_vampire_spawn_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3708, "s": 1.7},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.7},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3583, "s": 1.42},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 8583, "s": 1.83},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "026 Vampire Spawn 3",
            "variants": {}
        },
    },
    "026_vampire_spawn_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3708, "s": 1.7},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.7},
            "Claws": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3583, "s": 1.42},
            "Bite": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 8583, "s": 1.83},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "026 Vampire Spawn 4",
            "variants": {}
        },
    },
    "027_revenant_knight_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3583, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.9},
            "Longsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 5791, "s": 2.7},
            "Argent Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 6916, "s": 2.5},
            "Vengeful Glare": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 12541, "s": 3.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "027 Revenant Knight 1",
            "variants": {}
        },
    },
    "027_revenant_knight_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "special_3", "t": 1, "s": 1.5},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special_3", "t": 1, "s": 1.5},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3583, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.9},
            "Longsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 5791, "s": 2.5},
            "Argent Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 6916, "s": 2.3},
            "Vengeful Glare": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 12541, "s": 3.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "027 Revenant Knight 1",
            "variants": {}
        },
    },
    "027_revenant_knight_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3583, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.9},
            "Longsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 5791, "s": 2.5},
            "Argent Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 6916, "s": 2.3},
            "Vengeful Glare": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 12541, "s": 3.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "027 Revenant Knight 1",
            "variants": {}
        },
    },
    "027_revenant_knight_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "special_5", "t": 1, "s": 1.5},
            "combat_idle": {"fx": ["BFXShadow"], "a": "special_5", "t": 1, "s": 1.5},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3583, "s": 1.8},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.9},
            "Longsword": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 5791, "s": 2.5},
            "Argent Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 6916, "s": 2.3},
            "Vengeful Glare": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 12541, "s": 3.1},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "027 Revenant Knight 1",
            "variants": {}
        },
    },
    "028_unchained_armor": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 3458, "s": 1.5},
            "dead": {"fx": ["BFXShadowDead"], "a": "dead", "t": 1, "s": 1.7},
            "Lightning-Clad Fist": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 6916, "s": 1.5},
            "Lightning Blast": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_1", "t": 6291, "s": 2},
            "Coiling Chains": {"actionType": "attack", "fx": ["BFXShadow"], "a": "special_2", "t": 5124, "s": 3},
        },
        "config": {
            "scalefactor": 1,
            "compendium": "028 Unchained Armor",
            "variants": {}
        },
    },
    "029_infernal_steed_1": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4666, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Flaming Hooves": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3749, "s": 1},
            "Nightmare Gate": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_1", "t": 7916, "s": 1},
            "Blasting Charge": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 7916, "s": 1},
        },
        "config": {
            "scalefactor": 1.5,
            "compendium": "029 Infernal Steed 1",
            "variants": {}},
    },
    "029_infernal_steed_2": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4666, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Flaming Hooves": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3749, "s": 1},
            "Nightmare Gate": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_1", "t": 7916, "s": 1},
            "Blasting Charge": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 7916, "s": 1},
        },
        "config": {
            "scalefactor": 1.5,
            "compendium": "029 Infernal Steed 2",
            "variants": {}
        },
    },
    "029_infernal_steed_3": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4666, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Flaming Hooves": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3749, "s": 1},
            "Nightmare Gate": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_1", "t": 7916, "s": 1},
            "Blasting Charge": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 7916, "s": 1},
        },
        "config": {
            "scalefactor": 1.5,
            "compendium": "029 Infernal Steed 3",
            "variants": {}
        },
    },
    "029_infernal_steed_4": {
        "top": {
            "idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1},
            "move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1},
            "die": {"fx": ["BFXShadow"], "a": "die", "t": 4666, "s": 1},
            "dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Flaming Hooves": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 3749, "s": 1},
            "Nightmare Gate": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_1", "t": 7916, "s": 1},
            "Blasting Charge": {"actionType": "other", "fx": ["BFXShadow"], "a": "special_2", "t": 7916, "s": 1},
        },
        "config": {
            "scalefactor": 1.5,
            "compendium": "029 Infernal Steed 4",
            "variants": {}
        },
    },
	"030_commoner_1_m_worker": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 1 M Worker",
			"variants": {}
		},
	},
	"030_commoner_2_m_merchant": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 2 M Merchant",
			"variants": {}
		},
	},
	"030_commoner_3_m_beggar": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 3 M Beggar",
			"variants": {}},
	},
	"030_commoner_4_m_priest_1": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 4 M Priest 1",
			"variants": {}
		},
	},
	"030_commoner_5_m_priest_2": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 4 M Priest 2",
			"variants": {}
		},
	},
	"030_commoner_6_m_peasant_1": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 6 M Peasant 1",
			"variants": {}
		},
	},
	"030_commoner_7_m_peasant_2": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 7 M Peasant 2",
			"variants": {}
		},
	},
	"030_commoner_8_m": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 8 M",
			"variants": {}
		},
	},
	"030_commoner_9_m_noble": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 9 M Noble",
			"variants": {}
		},
	},
	"030_commoner_10_m_noble": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.5},
			"combat_idle": {"fx": ["BFXShadow"], "a": "special_4", "t": 1, "s": 1.5},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 2666, "s": 1.5},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.5},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 2999, "s": 1.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 10 M Noble",
			"variants": {}
		},
	},
	"030_commoner_11_f_priest": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 11 F Priest",
			"variants": {}
		},
	},
	"030_commoner_12_f_worker": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 12 F Worker",
			"variants": {}
		},
	},
	"030_commoner_13_f_herbalist": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 13 F Herbalist",
			"variants": {}
		},
	},
	"030_commoner_14_f_old": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 14 f old",
			"variants": {}
		},
	},
	"030_commoner_15_f_noble": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 15 f Noble",
			"variants": {}
		},
	},
	"030_commoner_16_f_noble_2": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 16 f Noble 2",
			"variants": {}
		},
	},
	"030_commoner_17_f_maid": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 17 f Maid",
			"variants": {}
		},
	},
	"030_commoner_18_f_mother": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 18 f Mother",
			"variants": {}
		},
	},
	"030_commoner_19_f": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 19 f",
			"variants": {}
		},
	},
	"030_commoner_20_f_peasant": {
		"top": {
			"idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"combat_idle": {"fx": ["BFXShadow"], "a": "idle", "t": 1, "s": 1.35},
			"move": {"fx": ["BFXShadow"], "a": "walk", "t": 1, "s": 1.35},
			"die": {"fx": ["BFXShadow"], "a": "die", "t": 3749, "s": 1.35},
			"dead": {"fx": ["BFXShadowDead", "BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.35},
			"Improvised Weapon (Melee)": {"actionType": "attack", "fx": ["BFXShadow"], "a": "attack", "t": 1291, "s": 1.35},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "030 commoner 20 f peasant",
			"variants": {}
		},
	},
	"031_swarm_of_vampire_bats":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.2},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.2},
			"move": {"fx":["BFXShadow"], "a": "idle", "t": 1, "s": 1.2},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 3999, "s": 1.2},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.2},
			"Ripping Fangs and Claws": {"actionType": "attack", "fx":["BFXShadow"], "a" : "attack" , "t": 3999, "s": 1.2},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "031 swarm of vampire bats",
			"variants": {}
		},
	},

	"032_night_hag_1":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.3},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.3},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.3},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2958, "s": 1.3},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 900, "s": 1.3},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.3},
			"Raking Nails" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 3083, "s": 1.3},
			"Manifest Nightmare" : {"actionType":"saves", "fx":["BFXShadow"], "a" : "special_3" , "t": 2583, "s": 1.3},
		},
			"config": {
			"scalefactor": 1,
			"compendium": "032 night hag 1",
			"variants": {}
		},
	},
		"032_night_hag_2":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.3},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.3},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.3},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2958, "s": 1.3},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 900, "s": 1.3},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.3},
			"Raking Nails" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 3083, "s": 1.3},
			"Manifest Nightmare" : {"actionType":"saves", "fx":["BFXShadow"], "a" : "special_3" , "t": 2583, "s": 1.3},
		},
			"config": {
			"scalefactor": 1,
			"compendium": "032 night hag 2",
			"variants": {}
		},
	},
		"032_night_hag_3":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.3},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.3},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.3},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2958, "s": 1.3},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 900, "s": 1.3},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.3},
			"Raking Nails" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 3083, "s": 1.3},
			"Manifest Nightmare" : {"actionType":"saves", "fx":["BFXShadow"], "a" : "special_3" , "t": 2583, "s": 1.3},
		},
			"config": {
			"scalefactor": 1,
			"compendium": "032 night hag 3",
			"variants": {}
		},
	},
	"033_yeti":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 3416, "s": 1},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
			"hit": {"fx":["BFXShadow"], "a": "hit", "t": 1791, "s": 1},
			"[Attack*] Ripping Claws" : {"actionType":"saves", "fx":["BFXShadow"], "a" : "attack" , "t": 2083, "s": 1},
			"[Action] Hunter's Howl" : {"actionType":"saves", "fx":["BFXShadow"], "a" : "special_1" , "t": 2291, "s": 1},
			"[Action*] Glacial Gaze" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_1" , "t": 2291, "s": 1},
			"[Action] Invoke Snowstorm" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_2" , "t": 10249, "s": 1},
		},
			"config": {
			"scalefactor": 1,
			"compendium": "033 yeti",
			"variants": {}
		},
	},
	"034_war-troll":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 2},
			"combat_idle":{"fx":["BFXShadow"], "a":"special_1", "t": 1, "s": 1},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.4},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 3333, "s": 1.9},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.9},
			"Mancrusher Greatclub" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1900, "s": 2.6},
			"Headbutt" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_2" , "t": 2624, "s": 2.3},
		},
			"config": {
				"scalefactor": 1,
				"compendium": "034 war-troll",
				"variants": {}
		},
	},
	
    "035_roc":{"top": {"idle":{"fx":["BFXShadow"], "a":"special_2", "t": 1, "s": 1.4},
			"combat_idle":{"fx":["BFXShadow"], "a":"special_3", "t": 1, "s": 4},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 4},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2833, "s": 3.8},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 3.8},
			"Talons" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1233, "s": 3.8},
			"Upon Tempestuous Wings" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 3500, "s": 3.7},
			/* Special 1: 4166 Special 2: 4999 Special 3: 1208 Special 4: -42 Special 5: -42 */
		},
			"config": {
				"scalefactor": 1,
				"compendium": "035 roc",
				"variants": {}
		},
	},
	"036_winter_empress_1":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.6},
			"hit": {"fx":["BFXShadow"], "a": "hit", "t": 700, "s": 1.6},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.6},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2833, "s": 5.7},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 5.7},
			"Winter's Kiss" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1700, "s": 2.8},
			"Absolute Zero" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 10200, "s": 7},
			"Aurora Crown" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 10200, "s": 7},
			"[Legendary Action] Black Ice Release" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 10200, "s": 7},			
			"Black Ice Effigy" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 4958, "s": 2.3},
			"[Reaction] Frost Shield" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 4958, "s": 2.3},	
			"[Reaction] Glacial Spark" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_3" , "t": 4000, "s": 4.1},	
		},
		"config": {
			"scalefactor": 1,
			"compendium": "036 winter empress 1",
			"variants": {}
		},
	},
	"036_winter_empress_2":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.6},
			"hit": {"fx":["BFXShadow"], "a": "hit", "t": 700, "s": 1.6},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.6},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2833, "s": 5.7},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 5.7},
			"Winter's Kiss" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1700, "s": 2.8},
			"Absolute Zero" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 10200, "s": 7},
			"Aurora Crown" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 10200, "s": 7},
			"[Legendary Action] Black Ice Release" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 10200, "s": 7},			
			"Black Ice Effigy" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 4958, "s": 2.3},
			"[Reaction] Frost Shield" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 4958, "s": 2.3},	
			"[Reaction] Glacial Spark" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_3" , "t": 4000, "s": 4.1},	
		},
		"config": {
			"scalefactor": 1,
			"compendium": "036 winter empress 2",
			"variants": {}
		},
	},
	"037_royal_griffon":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.4},
			"combat_idle":{"fx":["BFXShadow"], "a":"special_1", "t": 1, "s": 2.0},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.6},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2833, "s": 1.4},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.4},
			"Talons" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1500, "s": 1.6},
			"Eagle's Beak" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_3" , "t": 550, "s": 1.4},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "037 royal griffon",
			"variants": {}
		},
	},

	"038_arcane_incursor":{
		"top": {"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.2},
			"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.2},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.6},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 1958, "s": 2.3},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 2.3},
			"Piercing Spine" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1400, "s": 2.1},
			"Release Excess Arcana" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_1" , "t": 2166, "s": 2.1},
			"Suction Spine" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_2" , "t": 2291, "s": 2.5},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "038 arcane incursor",
			"variants": {}
		},
	},
	
	"039_elder_curseroot":{
		"top": {
			"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 2.1},
			"combat_idle":{"fx":["BFXShadow"], "a":"special_1", "t": 1, "s": 1.3},
			"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.1},
			"die": {"fx":["BFXShadow"], "a": "die", "t": 2541, "s": 1.7},
			"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.7},
			"Smashing Branch" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 2916, "s": 2},
		},
		"config": {
			"scalefactor": 1,
			"compendium": "039 elder curseroot",
			"variants": {}
		},
	},
/* Special 1: 9999 Special 2: 2666 Special 3: -42 Special 4: -42 Special 5: -42 */
"040_ossian_debt_collector":{
	"top": {
		"idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 3},
		"combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 3},
		"move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.8},
		"die": {"fx":["BFXShadow"], "a": "die", "t": 4749, "s": 2.5},
		"dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
		"Calcificator Greatsword" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 6708, "s": 3},
		"[Reaction] No Escape" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 2833, "s": 2.3},
		"Spiritual Leash" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 6249, "s": 2.7},
		"Ethereal Abduction" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_3" , "t": 2733, "s": 2.5},

		},
			"config": {
				"scalefactor": 1,
				"compendium": "040 ossian debt collector",
				"variants": {}
		},
	},
    "041_elephant":{
     /* Special 1: 3541 Special 2: -42 Special 3: -42 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.7},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.7},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.7},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 2999, "s": 1.6},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 1541, "s": 1.9},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 2.0, "s": 1.6},
            "Gore" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1916, "s": 1.7},
            "Fear Of Fire" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 3541, "s": 1.7},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "041 elephant",
			"variants": {}
        },
    },
	
    "042_mournbride":{
    /* Special 1: 3999 Special 2: 3291 Special 3: -42 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.1},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.1},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.2},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 5000, "s": 1.2},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 2208, "s": 1.4},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1},
            "Raking Nails" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 4000, "s": 1.5},
            "Heartrending Scream" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 3700, "s": 1.4},
            "Baleful Bond" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 3000, "s": 1.2},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "042 mournbride",
			"variants": {}
        },
    },
 

    "043_mind_golem":{
    /* Special 1: 4708 Special 2: 3916 Special 3: 5124 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 3},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 3},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 2.3},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 3000, "s": 3},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 2208, "s": 3},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 3},
            "Psi-charged Punch" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 2700, "s": 3},
            "Restabilize Mindmeld" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 4408, "s": 3},
            "Eye Beam" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 3400, "s": 3.2},
            "Innate Spellcasting (Psionics)" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_3" , "t": 4750, "s": 3},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "043 mind golem",
			"variants": {}
        },
    },
 
    "044_amygdalyan":{
    /* Special 1: -42 Special 2: 4458 Special 3: 2624 Special 4: 2666 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.1},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.1},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.5},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 2200, "s": 2.5},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 1000, "s": 3.3},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 2.5},
            "Probing Caress" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1400, "s": 2},
            "Collective Nightmare" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 2700, "s": 3},
            "Project Fear" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_4" , "t": 2300, "s": 1.6},
            "Infiltrate Mind" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_3" , "t": 1300, "s": 2.3},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "044 amygdalyan",
			"variants": {}
        },
    },
 
    "045_shattermaw":{
    /* Special 1: 2166 Special 2: -42 Special 3: -42 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.8},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.8},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.8},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 3541, "s": 2},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 1400, "s": 2},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 2},
            "Shattering Maw" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1700, "s": 2.0},
            "Bile Bombard" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 2166, "s": 2.0},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "045 shattermaw",
			"variants": {}
        },
    },
 
    "046_garghoul":{
    /* Special 1: 2749 Special 2: 3124 Special 3: -42 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 2.4},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 2.4},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 3},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 1700, "s": 3.1},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 800, "s": 3.1},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 2.5},
            "Raking Claws" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 2874, "s": 3.7},
            "Wingwrap" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_2" , "t": 2500, "s": 2.8},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "046 garghoul",
			"variants": {}
        },
    },
 
    "047_swifttalon_raptor":{
    /* Special 1: 2791 Special 2: -42 Special 3: -42 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 2},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 1.2},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 1.7},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 1400, "s": 1.4},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 1333, "s": 1.3},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 1.4},
            "Bite" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 1541, "s": 2},
            "Sickle Claw" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_1" , "t": 2000, "s": 2},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "047 swifttalon raptor",
			"variants": {}
        },
    },
 
    "048_stormwyvern":{
    /* Special 1: 4208 Special 2: 2583 Special 3: 2124 Special 4: -42 Special 5: -42 */
        "top": {
            "idle":{"fx":["BFXShadow"], "a":"special_4", "t": 1, "s": 2.5},
            "combat_idle":{"fx":["BFXShadow"], "a":"idle", "t": 1, "s": 3.5},
            "move": {"fx":["BFXShadow"], "a": "walk", "t": 1, "s": 3.5},
            "die": {"fx":["BFXShadow"], "a": "die", "t": 3499, "s": 3.5},
            "hit": {"fx":["BFXShadow"], "a": "hit", "t": 1666, "s": 3.5},
            "dead": {"fx":["BFXShadowDead","BFXDeadRedBlood"], "a": "dead", "t": 1, "s": 3.8},
            "Bite" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "attack" , "t": 2999, "s": 3.5},
            "Unleash Electricity" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_1" , "t": 4208, "s": 3},
            "Arcing Wingslam" : {"actionType":"attack", "fx":["BFXShadow"], "a" : "special_2" , "t": 2583, "s": 3},
            "Stormstinger" : {"actionType":"other", "fx":["BFXShadow"], "a" : "special_3" , "t": 2124, "s": 3.5},
        },

        "config": {
            "scalefactor": 1,
            "compendium": "048 stormwyvern",
			"variants": {}
        },
    },
};
