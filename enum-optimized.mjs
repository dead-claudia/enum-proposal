import {
    setDesc as _setDesc$,
    initEnum as _initEnum$,
    initObjectEnum as _initObjectEnum$,
    initSymbolEnum as _initSymbolEnum$,
    initStringEnum as _initStringEnum$,
    initNumberEnum as _initNumberEnum$,
} from "./enum-runtime.mjs"
const _makeSymbol$ = Symbol

// Simple object enums:
// Source
enum Foo { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _initObjectEnum$("Foo", 1, ["FOO", "BAR", "BAZ", "WAT"])

// Simple symbol enums:
// Source
enum Foo: Symbol { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _initEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"], [
    _makeSymbol$("FOO"), _makeSymbol$("BAR"),
    _makeSymbol$("BAZ"), _makeSymbol$("WAT")
])

// Simple string enums:
// Source
enum Foo: String { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _initStringEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"])

// Simple numeric enum
enum Foo: Number { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _initNumberEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"], 0)

// Simple numeric enum at offset
enum Foo: Number { FOO = 1, BAR, BAZ, WAT }

// Semantics
const Foo = _initNumberEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"], 1)

// Dynamic object enums:
// Source
enum Foo {
    FOO,
    BAR = 1,
    BAZ = BAR + 1,
    WAT,
}

// Semantics
const _tmp$ = _initObjectEnum$("Foo", 0, ["FOO", "BAR", "BAZ", "WAT"])
{
    _setDesc$(_tmp$.FOO, "FOO")
    const FOO = _tmp$.FOO
    _setDesc$(_tmp$.BAR, 1)
    const BAR = _tmp$.BAR
    _setDesc$(_tmp$.BAZ, BAR + 1)
    const BAZ = _tmp$.BAZ
    _setDesc$(_tmp$.WAT, "WAT")
    const WAT = _tmp$.WAT
}
const Foo = _tmp$

// Dynamic symbol enums:
// Source
enum Foo: Symbol {
    FOO,
    BAR = Symbol("1"),
    BAZ = Symbol(BAR.description + "2"),
    WAT,
}

// Semantics
let _tmp$
{
    const FOO = _makeSymbol$("FOO")
    const BAR = Symbol("1")
    if (typeof BAR !== "symbol") {
        throw new TypeError(`Enum variant Foo.BAR must be a symbol!`)
    }
    const BAZ = Symbol(BAR.description + "2")
    if (typeof BAZ !== "symbol") {
        throw new TypeError(`Enum variant Foo.BAZ must be a symbol!`)
    }
    const WAT = _makeSymbol$("WAT")
    _tmp$ = _makeEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"], [FOO, BAR, BAZ, WAT])
}
const Foo = _tmp$

// Dynamic string enums:
// Source
enum Foo: String {
    FOO,
    BAR = "1",
    BAZ = BAR + "2",
    WAT,
}

// Semantics
let _tmp$
{
    const FOO = "FOO"
    const BAR = `${"1"}`
    const BAZ = `${BAR + "2"}`
    const WAT = "WAT"
    _tmp$ = _makeEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"], [FOO, BAR, BAZ, WAT])
}
const Foo = _tmp$

// Dynamic number enums:
// Source
enum Foo: Number {
    FOO,
    BAR = 1,
    BAZ = BAR + 2,
    WAT,
}

// Semantics
let _tmp$
{
    const FOO = 0
    const BAR = +(1)
    const BAZ = +(BAR + 2)
    const WAT = BAZ + 1
    _tmp$ = _makeEnum$("Foo", ["FOO", "BAR", "BAZ", "WAT"], [FOO, BAR, BAZ, WAT])
}
const Foo = _tmp$
