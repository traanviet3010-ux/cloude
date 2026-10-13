package agentapi

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/hieusro/newcharacter"
)

func hieusroApplyNewCharacterDefaults(character *domain.Character) {
	newcharacter.Apply(character)
}
