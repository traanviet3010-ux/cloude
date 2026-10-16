package main

import (
    "fmt"
    "os"
    "strconv"
    "time"

    "github.com/ferdoran/go-sro/framework/client"
    "github.com/ferdoran/go-sro/framework/network"
)

func send(c *client.Client, id uint16, fill func(*network.Packet)) {
    p := network.EmptyPacket()
    p.MessageID = id
    if fill != nil { fill(&p) }
    c.OutgoingPacketChannel <- p
}

func wait(c *client.Client, id uint16, d time.Duration) network.Packet {
    t := time.NewTimer(d)
    defer t.Stop()
    for {
        select {
        case p := <-c.IncomingPacketChannel:
            fmt.Printf("RX=0x%04X\n", p.MessageID)
            if p.MessageID == id { return p }
        case <-t.C:
            panic(fmt.Sprintf("timeout waiting 0x%04X", id))
        }
    }
}

func main() {
    if len(os.Args) != 6 { panic("usage: probe user pass char version content_id") }
    user, pass, charName := os.Args[1], os.Args[2], os.Args[3]
    ver, _ := strconv.Atoi(os.Args[4])
    cid, _ := strconv.Atoi(os.Args[5])
    fmt.Printf("CLIENT_VERSION=%d\nCONTENT_ID=%d\n", ver, cid)

    gw := client.NewClient("127.0.0.1", 15779, "SR_Client")
    gw.Connect()
    fmt.Println("STEP_CONNECT_GATEWAY=PASS")

    send(gw, 0x6100, func(p *network.Packet) {
        p.WriteByte(byte(cid))
        p.WriteString("SR_Client")
        p.WriteUInt32(uint32(ver))
    })
    wait(gw, 0xA100, 10*time.Second)
    fmt.Println("STEP_PATCH_VERSION_219=PASS")

    send(gw, 0x6101, nil)
    wait(gw, 0xA101, 10*time.Second)
    fmt.Println("STEP_SERVER_LIST=PASS")

    send(gw, 0x6102, func(p *network.Packet) {
        p.WriteByte(byte(cid))
        p.WriteString(user)
        p.WriteString(pass)
        p.WriteUInt16(1)
    })
    lr := wait(gw, 0xA102, 10*time.Second)
    ok, _ := lr.ReadByte()
    if ok != 1 { panic(fmt.Sprintf("gateway login result=%d", ok)) }
    token, _ := lr.ReadUInt32()
    host, _ := lr.ReadString()
    port, _ := lr.ReadUInt16()
    fmt.Printf("STEP_GATEWAY_LOGIN=PASS AGENT=%s:%d\n", host, port)

    ag := client.NewClient(host, int(port), "SR_Client")
    ag.Connect()
    fmt.Println("STEP_CONNECT_AGENT=PASS")

    send(ag, 0x6103, func(p *network.Packet) {
        p.WriteUInt32(token)
        p.WriteString(user)
        p.WriteString(pass)
        p.WriteByte(byte(cid))
        p.WriteBytes([]byte{0, 0, 0, 0, 0, 0})
    })
    ar := wait(ag, 0xA103, 10*time.Second)
    aok, _ := ar.ReadByte()
    if aok != 1 { panic(fmt.Sprintf("agent auth result=%d", aok)) }
    fmt.Println("STEP_AGENT_AUTH=PASS")

    send(ag, 0x7007, func(p *network.Packet) { p.WriteByte(2) })
    cl := wait(ag, 0xB007, 10*time.Second)
    action, _ := cl.ReadByte()
    result, _ := cl.ReadByte()
    count, _ := cl.ReadByte()
    if action != 2 || result != 1 || count < 1 {
        panic(fmt.Sprintf("char list action=%d result=%d count=%d", action, result, count))
    }
    _, _ = cl.ReadUInt32()
    name, _ := cl.ReadString()
    fmt.Printf("STEP_CHARACTER_LIST=PASS COUNT=%d FIRST=%s\n", count, name)
    if name != charName { fmt.Printf("WARN_EXPECTED_CHAR=%s GOT=%s\n", charName, name) }

    send(ag, 0x7001, func(p *network.Packet) { p.WriteString(name) })
    jr := wait(ag, 0xB001, 10*time.Second)
    jok, _ := jr.ReadByte()
    if jok != 1 { panic(fmt.Sprintf("join result=%d", jok)) }
    fmt.Println("STEP_CHARACTER_SELECT=PASS")

    wait(ag, 0x34A5, 10*time.Second)
    wait(ag, 0x3013, 20*time.Second)
    wait(ag, 0x34A6, 10*time.Second)
    fmt.Println("STEP_MAP_DATA_SEQUENCE=PASS")
}
