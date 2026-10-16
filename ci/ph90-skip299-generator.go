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

type objectInfo struct { Index uint32; Path string }

func norm(s string) string {
    s = strings.ReplaceAll(s, "\\", "/")
    for strings.Contains(s, "//") { s = strings.ReplaceAll(s, "//", "/") }
    return strings.ToLower(strings.TrimPrefix(s, "./"))
}

func parseObjectInfo(b []byte) map[uint32]objectInfo {
    sc := bufio.NewScanner(strings.NewReader(string(b)))
    if !sc.Scan() || strings.TrimSpace(sc.Text()) != "JMXVOBJI1000" { panic("bad object.ifo") }
    if !sc.Scan() { panic("missing object.ifo count") }
    n, err := strconv.Atoi(strings.TrimSpace(sc.Text()))
    if err != nil { panic(err) }
    out := make(map[uint32]objectInfo, n)
    for i := 0; i < n; i++ {
        if !sc.Scan() { panic("object.ifo eof") }
        line := sc.Text()
        if len(line) < 19 { panic("short object.ifo line") }
        id, err := strconv.ParseUint(line[:5], 10, 32)
        if err != nil { panic(err) }
        out[uint32(id)] = objectInfo{uint32(id), strings.ReplaceAll(line[18:], "\"", "")}
    }
    return out
}

func parseNVM(b []byte) []uint32 {
    if len(b) < 14 || string(b[:12]) != "JMXVNVM 1000" { panic("bad nvm") }
    pos := 12
    n := int(binary.LittleEndian.Uint16(b[pos:pos+2]))
    pos += 2
    ids := make([]uint32, 0, n)
    for i := 0; i < n; i++ {
        if pos+32 > len(b) { panic("nvm record overflow") }
        id := binary.LittleEndian.Uint32(b[pos:pos+4])
        links := int(binary.LittleEndian.Uint16(b[pos+30:pos+32]))
        ids = append(ids, id)
        pos += 32 + links*6
        if pos > len(b) { panic("nvm links overflow") }
    }
    return ids
}

func main() {
    if len(os.Args) != 4 { panic("usage: generator Data.pk2 output.go output-dir") }
    r := pk2.NewPk2Reader(os.Args[1])
    r.IndexArchive()
    keys := map[string]bool{}
    for k := range r.Files { keys[norm(k)] = true }

    b, err := r.ReadFile("Data/navmesh/object.ifo")
    if err != nil { panic(err) }
    objects := parseObjectInfo(b)
    refs := map[uint32]bool{}
    for k, e := range r.Files {
        if strings.HasSuffix(norm(k), ".nvm") {
            for _, id := range parseNVM(r.ReadEntry(&e)) { refs[id] = true }
        }
    }

    var ids []int
    var paths []string
    for id := range refs {
        x, ok := objects[id]
        if !ok { panic(fmt.Sprintf("unresolved object %d", id)) }
        full := "Data/" + x.Path
        if !keys[norm(full)] {
            ids = append(ids, int(id))
            paths = append(paths, fmt.Sprintf("%d\t%s", id, full))
        }
    }
    sort.Ints(ids)
    sort.Strings(paths)
    if len(ids) != 299 { panic(fmt.Sprintf("expected exactly 299 missing resources, got %d", len(ids))) }

    var sb strings.Builder
    sb.WriteString("package navmeshv2\n\nvar ph90SkipMissingObjectIndices = map[uint32]struct{}{\n")
    for _, id := range ids { sb.WriteString(fmt.Sprintf("\t%d: {},\n", id)) }
    sb.WriteString("}\n")
    if err := os.WriteFile(os.Args[2], []byte(sb.String()), 0644); err != nil { panic(err) }
    if err := os.WriteFile(os.Args[3]+"/skip299-paths.tsv", []byte(strings.Join(paths, "\n")+"\n"), 0644); err != nil { panic(err) }
    fmt.Printf("EXACT_SKIP_OBJECT_IDS=%d\n", len(ids))
}
