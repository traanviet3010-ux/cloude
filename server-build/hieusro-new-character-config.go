package newcharacter

import (
	"encoding/json"
	"os"
	"strings"

	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/progression"
)

const EnvSettingsPath = "HIEUSRO_NEW_CHARACTER_SETTINGS"

const (
	maxLevel        = int64(140)
	maxGold         = int64(1_000_000_000_000)
	maxSkillPoints  = int64(1_000_000_000)
	maxStatPoints   = int64(65535)
	maxStarterItems = 16
	firstBagSlot    = int64(13)
	lastBagSlot     = int64(44)
)

type StarterItem struct {
	Codename string `json:"codename"`
	Count    int64  `json:"count"`
	Plus     int64  `json:"plus"`
}

type Settings struct {
	SchemaVersion   int           `json:"schemaVersion"`
	Enabled         bool          `json:"enabled"`
	Level           int64         `json:"level"`
	Gold            int64         `json:"gold"`
	SkillPoints     int64         `json:"skillPoints"`
	StatPoints      int64         `json:"statPoints"`
	KeepDefaultGear bool          `json:"keepDefaultGear"`
	StarterItems    []StarterItem `json:"starterItems"`
}

func defaults() Settings {
	return Settings{SchemaVersion: 1, Level: 1, KeepDefaultGear: true, StarterItems: []StarterItem{}}
}

func clamp(value, lo, hi int64) int64 {
	if value < lo {
		return lo
	}
	if value > hi {
		return hi
	}
	return value
}

func load() Settings {
	cfg := defaults()
	path := strings.TrimSpace(os.Getenv(EnvSettingsPath))
	if path == "" {
		return cfg
	}
	raw, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(raw, &cfg) != nil {
		return defaults()
	}
	cfg.SchemaVersion = 1
	cfg.Level = clamp(cfg.Level, 1, maxLevel)
	cfg.Gold = clamp(cfg.Gold, 0, maxGold)
	cfg.SkillPoints = clamp(cfg.SkillPoints, 0, maxSkillPoints)
	cfg.StatPoints = clamp(cfg.StatPoints, 0, maxStatPoints)
	if len(cfg.StarterItems) > maxStarterItems {
		cfg.StarterItems = cfg.StarterItems[:maxStarterItems]
	}
	clean := make([]StarterItem, 0, len(cfg.StarterItems))
	for _, row := range cfg.StarterItems {
		row.Codename = strings.ToUpper(strings.TrimSpace(row.Codename))
		if !strings.HasPrefix(row.Codename, "ITEM_") || len(row.Codename) > 128 {
			continue
		}
		row.Count = clamp(row.Count, 1, 65535)
		row.Plus = clamp(row.Plus, 0, 15)
		clean = append(clean, row)
	}
	cfg.StarterItems = clean
	return cfg
}

// Apply mutates only the freshly-created record before Store.CreateCharacter
// validates and persists it. Existing characters are never touched.
func Apply(character *domain.Character) {
	if character == nil {
		return
	}
	cfg := load()
	if !cfg.Enabled {
		return
	}
	level := cfg.Level
	experience := int64(0)
	gold := cfg.Gold
	skillPoints := cfg.SkillPoints
	statPoints := cfg.StatPoints
	strength := progression.BaseStatAtLevel(level)
	intellect := strength
	character.Level = &level
	character.Experience = &experience
	character.Gold = &gold
	character.SkillPoints = &skillPoints
	character.StatPoints = &statPoints
	character.Strength = &strength
	character.Intellect = &intellect
}

// WrapInventorySeeder preserves native creation equipment unless the GM
// disables it, then adds configured starter-pack rows to free bag slots.
func WrapInventorySeeder(base func(*domain.Character), items enterworld.ItemRefSource) func(*domain.Character) {
	return func(character *domain.Character) {
		if character == nil {
			return
		}
		cfg := load()
		if !cfg.Enabled {
			base(character)
			return
		}
		if cfg.KeepDefaultGear {
			base(character)
		} else if character.MissionInventory == nil {
			character.MissionInventory = []domain.InventoryRow{}
		}
		if items == nil || len(cfg.StarterItems) == 0 {
			return
		}
		if character.MissionInventory == nil {
			character.MissionInventory = []domain.InventoryRow{}
		}
		used := map[int64]bool{}
		for _, row := range character.MissionInventory {
			used[row.Slot] = true
		}
		nextFree := func() (int64, bool) {
			for slot := firstBagSlot; slot <= lastBagSlot; slot++ {
				if !used[slot] {
					used[slot] = true
					return slot, true
				}
			}
			return 0, false
		}
		for _, grant := range cfg.StarterItems {
			ref, ok := items.ItemRefByCodename(grant.Codename)
			if !ok || ref == nil {
				continue
			}
			cap := ref.NativeStackCap()
			if cap < 1 {
				cap = 1
			}
			remaining := grant.Count
			for remaining > 0 {
				slot, ok := nextFree()
				if !ok {
					return
				}
				stack := remaining
				if stack > cap {
					stack = cap
				}
				plus := int64(0)
				if cap == 1 {
					plus = grant.Plus
				}
				durability := int64(0)
				if ref.MaxDurability > 0 {
					durability = 100
					if ref.VarianceIntMin1c0 != nil {
						durability = clamp(*ref.VarianceIntMin1c0, 1, 0xffffffff)
					}
				}
				character.MissionInventory = append(character.MissionInventory, domain.InventoryRow{
					Slot: slot, RefObjID: ref.RefObjID, Codename: ref.Codename, TypeFlags: ref.TypeFlags(),
					Plus: plus, VarianceBits: "0", Durability: durability, StackCount: stack,
				})
				remaining -= stack
			}
		}
	}
}
