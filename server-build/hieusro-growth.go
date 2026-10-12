package progression

import (
	"os"
	"strconv"
	"strings"

	"opensro.online/server/internal/game/enterworld"
)

const EnvBetaGrowth = "SRO_BETA_GROWTH"
const EnvBetaSkillExpRate = "SRO_BETA_SKILL_EXP_RATE"
const EnvBetaDropRate = "SRO_BETA_DROP_RATE"
const EnvBetaGoldRate = "SRO_BETA_GOLD_RATE"
const EnvBetaRareRate = "SRO_BETA_RARE_RATE"
const EnvBetaDropCap = "SRO_BETA_DROP_CAP"
const EnvHieuExpRate = "SRO_HIEUSRO_EXP_RATE"

const BetaReferenceLevel = 1
const betaSkillExpRateDefault = 100
const betaDropRateDefault = 20
const maxBetaDropRate = 100
const betaDropCapDefault = 16
const maxBetaDropCap = 1000
const betaGoldRateDefault = 50
const maxBetaGoldRate = 10_000
const betaRareRateDefault = 5
const maxBetaRareRate = 1000
const maxHieuExpRate = 1000

type GrowthRates struct {
	Enabled          bool
	LevelCompression bool
	ExpRate          int64
	SkillExpRate     int64
	DropRate         int
	DropCap          int
	GoldRate         int
	RareRate         int
}

func betaGrowthEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(EnvBetaGrowth))) {
	case "on", "1", "true":
		return true
	default:
		return false
	}
}

func BetaGrowthFromEnv() GrowthRates {
	beta := betaGrowthEnabled()
	rates := GrowthRates{
		LevelCompression: beta,
		ExpRate:          1,
		SkillExpRate:     1,
		DropRate:         1,
		DropCap:          0,
		GoldRate:         1,
		RareRate:         1,
	}
	if beta {
		rates.SkillExpRate = betaSkillExpRateDefault
		rates.DropRate = betaDropRateDefault
		rates.DropCap = betaDropCapDefault
		rates.GoldRate = betaGoldRateDefault
		rates.RareRate = betaRareRateDefault
	}
	if text := strings.TrimSpace(os.Getenv(EnvHieuExpRate)); text != "" {
		if n, err := strconv.ParseInt(text, 10, 64); err == nil && n >= 1 && n <= maxHieuExpRate {
			rates.ExpRate = n
		}
	}
	if text := strings.TrimSpace(os.Getenv(EnvBetaSkillExpRate)); text != "" {
		if n, err := strconv.ParseInt(text, 10, 64); err == nil && n >= 1 && n <= 10000 {
			rates.SkillExpRate = n
		}
	}
	if text := strings.TrimSpace(os.Getenv(EnvBetaDropRate)); text != "" {
		if n, err := strconv.Atoi(text); err == nil && n >= 1 && n <= maxBetaDropRate {
			rates.DropRate = n
		}
	}
	if text := strings.TrimSpace(os.Getenv(EnvBetaDropCap)); text != "" {
		if n, err := strconv.Atoi(text); err == nil && n >= 0 && n <= maxBetaDropCap {
			rates.DropCap = n
		}
	}
	if text := strings.TrimSpace(os.Getenv(EnvBetaGoldRate)); text != "" {
		if n, err := strconv.Atoi(text); err == nil && n >= 1 && n <= maxBetaGoldRate {
			rates.GoldRate = n
		}
	}
	if text := strings.TrimSpace(os.Getenv(EnvBetaRareRate)); text != "" {
		if n, err := strconv.Atoi(text); err == nil && n >= 1 && n <= maxBetaRareRate {
			rates.RareRate = n
		}
	}
	rates.Enabled = beta || rates.ExpRate != 1 || rates.SkillExpRate != 1 || rates.DropRate != 1 || rates.DropCap != 0 || rates.GoldRate != 1 || rates.RareRate != 1
	if !rates.Enabled {
		return GrowthRates{}
	}
	return rates
}

func levelKills(levels enterworld.LevelDataSource, level int64) (float64, bool) {
	need, ok := levels.ExpRequired(level)
	if !ok || need <= 0 {
		return 0, false
	}
	basis, ok := levels.MonsterExpBasis(level)
	if !ok || basis <= 0 {
		return 0, false
	}
	return float64(need) / float64(basis), true
}

func levelPace(levels enterworld.LevelDataSource, level int64) float64 {
	if levels == nil {
		return 1
	}
	kills, ok := levelKills(levels, level)
	reference, refOK := levelKills(levels, BetaReferenceLevel)
	if !ok || !refOK || kills <= reference {
		return 1
	}
	return kills / reference
}

func (g GrowthRates) ExpPace(levels enterworld.LevelDataSource, level int64) float64 {
	if !g.Enabled {
		return 1
	}
	pace := 1.0
	if g.LevelCompression {
		pace = levelPace(levels, level)
	}
	return pace * float64(max(g.ExpRate, 1))
}

func (g GrowthRates) scale(levels enterworld.LevelDataSource, level, expDelta, skillExpDelta int64) (int64, int64) {
	if !g.Enabled {
		return expDelta, skillExpDelta
	}
	pace := 1.0
	if g.LevelCompression {
		pace = levelPace(levels, level)
	}
	if expDelta > 0 {
		expDelta = int64(min(float64(expDelta)*pace*float64(max(g.ExpRate, 1)), float64(1<<62)))
	}
	if skillExpDelta > 0 {
		rate := float64(max(g.SkillExpRate, 1))
		skillExpDelta = int64(min(float64(skillExpDelta)*pace*rate, float64(1<<62)))
	}
	return expDelta, skillExpDelta
}
