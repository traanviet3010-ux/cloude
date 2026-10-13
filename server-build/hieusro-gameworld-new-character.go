package main

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/hieusro/newcharacter"
)

func hieusroStarterInventorySeeder(roster *enterworld.Roster, items enterworld.ItemRefSource, equipItemsEnabled bool) func(*enterworld.Character) {
	base := enterworld.StarterInventorySeeder(roster, items, equipItemsEnabled)
	return newcharacter.WrapInventorySeeder(base, items)
}
