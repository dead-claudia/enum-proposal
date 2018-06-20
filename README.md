# A proper enum proposal for JS

I've seen many times people wanting enums to appear in JS. But so far, they've looked like one of the following semantically:

```js
// Keys with mirroring string values
// makeEnum("foo", "bar", ...)
function makeEnum(...variants) {
    const result = {}
    for (const name of variants) {
        result[name] = name
    }
    return Object.freeze(result)
}

// Keys with mirroring symbol values
// makeEnum("foo", "bar", ...)
function makeEnum(...variants) {
    const result = {}
    for (const name of variants) {
        result[result[name] = Symbol(name)] = name
    }
    return Object.freeze(result)
}

// Keys with successive integer values
// makeEnum("foo", "bar", ...)
function makeEnum(...variants) {
    const result = {}
    for (const [i, name] of variants.entries()) {
        result[result[name] = i] = name
    }
    return Object.freeze(result)
}

// Keys with optionally specified, successive integer values
// makeEnum(["foo"], ["bar", 1], ...)
function makeEnum(...variants) {
    const result = {}
    let acc = 0
    for (const [key, value = acc] of variants) {
        if (Number.isInteger(value)) acc = value
        result[key] = value
        acc++
    }
    return Object.freeze(result)
}
```

But with these, I only see issues with each one:

- With string values, what makes them any different from string literals? They're identical cross-realm, but string literals are already pretty good at not getting mixed up with other variants. (They're also easy to debug on their own.)
- With string values, comparison is non-trivial in of itself. The fast path is when they're equal, but when they're not, you almost always have to iterate, and this is probably just as common as equality in practice. That is *not* something you want in performance-critical code, and enums are pretty popular there (particularly integer enums).
- Integer values are a beast to debug, and are very non-obvious without the surrounding context. You almost have to have an editor open to the file where all the variants are defined just to make sense of them. (It also becomes necessary to group them into a single file, so it's easier to track what values mean what.)
- Symbols don't work cross-realm, so you have to have an easy, efficient deserialization method for them. That in turn generates boilerplate *you* have to write. Plus, they're flat out useless for storing portions of bit masks, which is a pretty common use in performance-sensitive contexts.
- Integer enums don't have any sort of guaranteed uniqueness, and nor do strings. A `1` or `"foo"` could be passed in from the wrong enum, and you'd never know - it would just work, and when someone reading that code gets confused and tries an enum value there from the wrong enum, one whose value is *not* supposed to work or even be possible, things will blow up inexplicably.

Finally, there are certain factors which make it much harder to just pick one:

- Integer enums are great for things like binary protocol parsing and low-memory objects. You need to care about the exact bits used to represent something quite frequently in these contexts, and that's precisely what integers are for.
- String enums are great for things like network API interop and prototyping. They're super easy to debug and read, and pretty much everything on the web is written with strings in mind, rather than binary data (for better or for worse - consider HTTP/1.1 vs HTTP/2).
- Symbol enums are great for things like event listeners, action names within streams, and similar. When you need to use something as a key to tie to an action you control within a centralized stream of actions you don't control, you almost have to use symbols just to not stomp on everyone. (It's also one of the biggest stumbling blocks scaling things like Redux - string action names just don't scale.)

## Proposal

Here's what I propose:

- Enums are effectively frozen objects. Everyone would expect this.
- Enum variants are themselves frozen objects.
- Several helper methods exist on enums to make it easier for them to remap integers, strings, and symbols to their enum variants.

### Syntax

```js
// Object enum.
enum Foo {
    // Mostly equivalent to `FOO = "FOO"`
    FOO,
    // Values may be specified, and is returned from both `toString`, `valueOf`,
    // and `toJSON`.
    BAR = FOO.symbol.description + "bar",
}

// Symbol enum. Note that `Symbol` here is syntactic.
enum Foo: Symbol {
    // Mostly equivalent to `FOO = Symbol("FOO")`
    FOO,
    // Values may be specified, but it is a type error for them to not evaluate
    // to a symbol.
    BAR = Symbol(FOO.symbol.description + "bar"),
}

// String enum. Note that `String` here is syntactic.
enum Foo: String {
    // Equivalent to FOO = "foo"
    FOO,
    // Subsequent values may depend on previous values.
    BAR = FOO + "bar",
}

// Number enum. Note that `Number` here is syntactic.
enum Foo: Number {
    // Equivalent to FOO = 0
    FOO,
    // Subsequent values may depend on previous values.
    BAR = FOO + 1,
}
```

Note that it is an early error to specify a variant whose name collides with another variant, and it's an early error to specify a variant whose name collides with an enum's magic methods/properties (like `getKey` or `compare`).

During initialization, previously declared enum variants are available as constants within the scope of subsequent enum variant initializers, but later declared variants are behind a TDZ within that scope, but their bindings do not escape the enum's scope. This means, normally you'd get a `ReferenceError` if you were to evaluate one that's not ready yet, but if you were to do something like this, it would not error.

```js
let getSecond
enum Foo: String {
    First = (getSecond = () => Second, "First"),
    Second = "Second",
}

getSecond() === Foo.Second // true
```

The enum is also guarded via TDZ, and is not defined until after all its variants are defined.

### Semantics

#### Enum objects

Enum instances are frozen ordinary objects that inherit from `null` with a few internal slots for optimization and bookkeeping and a few extra helper methods:

- `Enum.name -> string` - Get this enum's name.
- `Enum.getKey(value) -> key` - Do a reverse lookup from value to key for this enum.
- `Enum.compare(a, b) -> 1 | 0 | -1` - Compare two enum variants by position.
- `Enum.keys() -> iter` - Iterate the keys in this enum.
- `Enum.values() -> iter` - Iterate the values in this enum.
- `Enum.entries() -> iter` - Iterate the keys and values together in this enum. (Alias: `Enum[Symbol.iterator]`)
- `Enum[Symbol.hasInstance](other) -> boolean` - Return `true` if and only if this value is a member of this enum.

Each method forms a closure over the enum, so they don't need to be bound to be used. It also makes it easier to optimize.

#### Enum variant objects

Enum variant instances are frozen ordinary objects that inherit from %EnumVariantPrototype%, which itself is a frozen ordinary object that inherits from `null` and has the following properties and methods:

- `variant.type` - This is a self reference, for a potential future expansion into ADTs (which would have this set).
- `variant.name` - This returns the declared name for the variant.
- `variant.parentEnum` - This returns the parent enum for the variant.
- `variant.value` - This returns the inner value within the variant.
- `variant.toString()`, `variant.valueOf()`, and `variant.toJSON()` all three return the raw value, for convenience.

The enum value is determined as follows:

- If no value is given, the name itself is used as the value, as a string.
- If an explicit value is given, it's kept in raw form.

For a concrete example:

```js
const baz = {}

enum Foo {
    FOO,
    BAR = 1,
    BAZ = baz,
}

assert(Foo.FOO.value, "FOO")
assert(Foo.BAR.value, 1)
```

#### Desugaring

```js
// Simple object enums:
// Source
enum Foo { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _makeEnum("Foo", ["FOO", "BAR", "BAZ", "WAT"])

// Simple symbol enums:
// Source
enum Foo: Symbol { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _makeEnum("Foo",
    ["FOO", "BAR", "BAZ", "WAT"],
    [Symbol("FOO"), Symbol("BAR"), Symbol("BAZ"), Symbol("WAT")]
)

// Simple string enums:
// Source
enum Foo: String { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _makeEnum("Foo",
    ["FOO", "BAR", "BAZ", "WAT"],
    ["FOO", "BAR", "BAZ", "WAT"]
)

// Simple numeric enum
enum Foo: Number { FOO, BAR, BAZ, WAT }

// Semantics
const Foo = _makeEnum("Foo",
    ["FOO", "BAR", "BAZ", "WAT"],
    [0, 1, 2, 3]
)

// Dynamic object enums:
// Source
enum Foo {
    FOO,
    BAR = 1,
    BAZ = BAR + 1,
    WAT,
}

// Semantics
const _tmp$ = _makeEnum("Foo", ["FOO", "BAR", "BAZ", "WAT"])
{
    _valueMap.set(_tmp$.FOO, "FOO")
    const FOO = _tmp$.FOO
    _valueMap.set(_tmp$.BAR, `${1}`)
    const BAR = _tmp$.BAR
    _valueMap.set(_tmp$.BAZ, `${BAR + 1}`)
    const BAZ = _tmp$.BAZ
    _valueMap.set(_tmp$.WAT, "WAT")
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
    const FOO = Symbol("FOO")
    const BAR = Symbol("1")
    if (typeof BAR !== "symbol") {
        throw new TypeError(`Enum variant Foo.BAR must be a symbol!`)
    }
    const BAZ = Symbol(BAR.description + "2")
    if (typeof BAZ !== "symbol") {
        throw new TypeError(`Enum variant Foo.BAZ must be a symbol!`)
    }
    const WAT = Symbol("WAT")
    _tmp$ = _makeEnum("Foo", ["FOO", "BAR", "BAZ", "WAT"], [FOO, BAR, BAZ, WAT])
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
    _tmp$ = _makeEnum("Foo", ["FOO", "BAR", "BAZ", "WAT"], [FOO, BAR, BAZ, WAT])
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
    _tmp$ = _makeEnum("Foo", ["FOO", "BAR", "BAZ", "WAT"], [FOO, BAR, BAZ, WAT])
}
const Foo = _tmp$
```

The helpers `_makeEnum` and `_valueMap` are defined below:

```js
const _valueMap = new WeakMap()
const _makeEnum = (() => {
    "use strict"

    function initObject(object) {
        const desc = {enumerable: false}
        Object.getOwnPropertyNames(object)
            .concat(Object.getOwnPropertySymbols(object))
            .forEach(key => Object.defineProperty(object, key, desc))
    }

    const iteratorData = new WeakMap()

    const IteratorPrototype = Object.getPrototypeOf(
        Object.getPrototypeOf([].keys())
    )
    const EnumIteratorPrototype = Object.create(IteratorPrototype)
    Object.assign(EnumIteratorPrototype, {
        next() {
            const data = iteratorData.get(this)

            if (data == null) {
                throw new TypeError("`this` must be an enum iterator object!")
            }

            return data.next()
        },
    })
    initObject(EnumIteratorPrototype)

    Object.defineProperty(EnumIteratorPrototype, Symbol.toStringTag, {
        configurable: false, enumerable: false, writable: false,
        value: "Enum Iterator",
    })

    function createIterator(state) {
        const iter = Object.create(EnumIteratorPrototype)
        iteratorData.set(iter, state)
        return iter
    }

    const variantName = new WeakMap()
    const variantParentEnum = new WeakMap()
    const EnumVariantPrototype = Object.create(null)

    function getChecked(map, object) {
        if (variantParentEnum.has(object)) return map.get(object)
        throw new TypeError("`this` is not an enum variant!")
    }

    function installProperties(object, keys, methods) {
        for (let i = 0; i < keys.length; i++) {
            const desc = Object.getOwnPropertyDescriptor(methods, keys[i])

            desc.enumerable = false
            Object.defineProperty(object, keys[i], desc)
        }
    }

    Object.defineProperty(EnumIteratorPrototype, Symbol1.toStringTag, {
        configurable: false, enumerable: false, writable: false,
        value: "Enum Iterator",
    })

    installProperties(EnumVariantPrototype, [
        "type", "name", "parentEnum", "value",
        "toString", "valueOf", "toJSON",
    ], {
        get type() { return this },
        get name() { return getChecked(variantName, this) },
        get parentEnum() { return getChecked(variantParentEnum, this) },
        get value() { return getChecked(_valueMap, this) },
        toString() { return getChecked(_valueMap, this) },
        valueOf() { return getChecked(_valueMap, this) },
        toJSON() { return getChecked(_valueMap, this) },
    })

    Object.freeze(EnumVariantPrototype)

    return (name, keys, values) => {
        const keyMap = new Map()
        const valueMap = new Map()
        const revMap = new Map()
        const object = Object.create(null)

        Object.assign(object, {
            [Symbol.toStringTag]: "Enum",
            name,

            getKey(value) {
                return valueMap.get(value)
            },

            [Symbol.hasInstance](value) {
                return valueMap.has(value)
            },

            compare(a, b) {
                const indexA = keyMap.get(a)
                const indexB = keyMap.get(b)

                if (indexA != null && indexA != null) {
                    if (indexA === indexB) return 0
                    return indexA < indexB ? -1 : 1
                }

                throw new Error("Both arguments must be members of this enum!")
            },

            keys() {
                return createIterator(revMap.keys())
            },

            values() {
                return createIterator(revMap.values())
            },

            entries() {
                return createIterator(revMap.entries())
            },
        })

        object[Symbol.iterator] = object.keys

        if (values == null) {
            object.prototype = EnumVariantPrototype

            const deserialize = variant => {
                if (!weakHas(nameMap, variant)) {
                    throw new TypeError(
                        `\`this\` is not a member of enum \`${name}\`!`
                    )
                }
                return weakGet(nameMap, variant)
            }
            Object.freeze(object.prototype)
            initObject(object)

            for (let i = 0; i < keys.length; i++) {
                const variant = Object.freeze(
                    Object.create(EnumVariantPrototype)
                )

                variantName.set(variant, keys[i])
                _valueMap.set(variant, keys[i])
                variantParentEnum.set(variant, object)
                keyMap.set(variant, i)
                valueMap.set(variant, keys[i])
                revMap.set(keys[i], variant)
                object[keys[i]] = variant
            }
        } else {
            initObject(object)

            for (let i = 0; i < keys.length; i++) {
                keyMap.set(keys[i], i)
                valueMap.set(values[i], keys[i])
                revMap.set(keys[i], values[i])
                object[keys[i]] = values[i]
            }
        }

        return [Object.freeze(object), nameMap]
    }
})();
```

A more optimized, better-spec'd [runtime](https://github.com/isiahmeadows/enum-proposal/blob/master/enum-runtime.mjs) + [possible transpiler output](https://github.com/isiahmeadows/enum-proposal/blob/master/enum-optimized.mjs) is available. Those carry the same semantics, but are much better for production.

### Implementation Tips

There are optimization opportunities here that can really help speed up the implementation quite a bit. The spec doesn't always make them clear, but optimizing these are pretty critical to making them viable in performance-critical code. I did take a few careful considerations to enable engines to propagate constants in certain places:

1. Enums have all their methods as own methods forming a closure over the enum, rather than prototype methods. This makes it easier to specialize. (Note that the enum iterator is not spec'd likewise, so the optimization does not hold here.)

1. Enums are frozen at creation time without a prototype, so they don't need any `Object.prototype` checking at all, and they trigger no side effects when initializing apart from the variants' values themselves. Use this to your advantage for propagating constants, since enums within a closure can have their full implementations inlined without visible side effect. (This means you can lower it to a zero-cost abstraction within the bytecode if the enum is not itself exposed or iterated.)

1. For integer enum variants with only automatic values, the values can double as indices, so you can dodge about 90% of the memory and logic overhead with many of the methods. The optimized transpiler runtime itself already uses this to its advantage.
