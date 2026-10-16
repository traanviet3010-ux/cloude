package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/ferdoran/go-sro/framework/pk2"
)

type candidate struct {
	ID        int
	Continent string
}

func parseNVMObjectIDs(data []byte) ([]uint32, error) {
	if len(data) < 14 || string(data[:12]) != "JMXVNVM 1000" {
		return nil, fmt.Errorf("invalid NVM")
	}
	pos := 12
	count := int(binary.LittleEndian.Uint16(data[pos : pos+2]))
	pos += 2
	ids := make([]uint32, 0, count)
	for i := 0; i < count; i++ {
		if pos+32 > len(data) {
			return nil, fmt.Errorf("object record overflow")
		}
		id := binary.LittleEndian.Uint32(data[pos : pos+4])
		links := int(binary.LittleEndian.Uint16(data[pos+30 : pos+32]))
		ids = append(ids, id)
		pos += 32 + links*6
		if pos > len(data) {
			return nil, fmt.Errorf("link overflow")
		}
	}
	return ids, nil
}

func main() {
	if len(os.Args) != 5 {
		panic("usage: select-safe-region <Data.pk2> <skip-ids.txt> <regions.tsv> <output.txt>")
	}

	skipBytes, err := os.ReadFile(os.Args[2])
	if err != nil { panic(err) }
	skip := map[uint32]bool{}
	for _, line := range strings.Fields(string(skipBytes)) {
		n, err := strconv.ParseUint(strings.TrimSpace(line), 10, 32)
		if err != nil { panic(err) }
		skip[uint32(n)] = true
	}
	if len(skip) != 299 {
		panic(fmt.Sprintf("expected 299 skip ids, got %d", len(skip)))
	}

	f, err := os.Open(os.Args[3])
	if err != nil { panic(err) }
	defer f.Close()
	var all []candidate
	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.SplitN(s.Text(), "\t", 2)
		if len(parts) != 2 { continue }
		id, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil { panic(err) }
		all = append(all, candidate{ID: id, Continent: strings.TrimSpace(parts[1])})
	}
	if err := s.Err(); err != nil { panic(err) }

	r := pk2.NewPk2Reader(os.Args[1])
	r.IndexArchive()

	type safe struct {
		candidate
		NVM       string
		ObjectCnt int
	}
	var safeJangan, safeOther []safe
	withNVM := 0
	unsafeSkip := 0
	missingNVM := 0
	var audit []string

	for _, c := range all {
		if c.ID < 0 || c.ID > 0x7fff { continue }
		path := fmt.Sprintf("Data/navmesh/nv_%x.nvm", int16(c.ID))
		data, err := r.ReadFile(path)
		if err != nil {
			missingNVM++
			continue
		}
		withNVM++
		ids, err := parseNVMObjectIDs(data)
		if err != nil { panic(fmt.Sprintf("%s: %v", path, err)) }
		bad := 0
		for _, id := range ids {
			if skip[id] { bad++ }
		}
		if bad > 0 {
			unsafeSkip++
			audit = append(audit, fmt.Sprintf("UNSAFE_SKIP\t%d\t%s\t%s\tobjects=%d\tskip_refs=%d", c.ID, c.Continent, path, len(ids), bad))
			continue
		}
		x := safe{candidate: c, NVM: path, ObjectCnt: len(ids)}
		if strings.EqualFold(c.Continent, "Jangan") {
			safeJangan = append(safeJangan, x)
		} else {
			safeOther = append(safeOther, x)
		}
	}

	sort.Slice(safeJangan, func(i, j int) bool { return safeJangan[i].ID < safeJangan[j].ID })
	sort.Slice(safeOther, func(i, j int) bool { return safeOther[i].ID < safeOther[j].ID })
	var chosen safe
	if len(safeJangan) > 0 {
		chosen = safeJangan[0]
	} else if len(safeOther) > 0 {
		chosen = safeOther[0]
	} else {
		panic("no safe region found")
	}

	out := fmt.Sprintf("REGION_ROWS=%d\nREGIONS_WITH_NVM=%d\nREGIONS_MISSING_NVM=%d\nREGIONS_WITH_SKIP299_REFS=%d\nSAFE_JANGAN_REGIONS=%d\nSAFE_OTHER_REGIONS=%d\nSELECTED_REGION_ID=%d\nSELECTED_REGION_HEX=0x%04X\nSELECTED_CONTINENT=%s\nSELECTED_NVM=%s\nSELECTED_NVM_OBJECTS=%d\n",
		len(all), withNVM, missingNVM, unsafeSkip, len(safeJangan), len(safeOther), chosen.ID, uint16(chosen.ID), chosen.Continent, chosen.NVM, chosen.ObjectCnt)
	if err := os.WriteFile(os.Args[4], []byte(out), 0644); err != nil { panic(err) }
	fmt.Print(out)
}
