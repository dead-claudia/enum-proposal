export {setValue, initEnum, initStringEnum, initNumberEnum, initObjectEnum}

const objectKeys = Object.keys
const objectCreate = Object.create
const getPrototypeOf = Object.getPrototypeOf
const defineProperty = Object.defineProperty
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const freeze = Object.freeze
const isExtensible = Object.isExtensible
const symbolToStringTag = Symbol.toStringTag
const symbolHasInstance = Symbol.hasInstance
const symbolIterator = Symbol.iterator
const Map1 = Map
const iteratorData = /* @__PURE__ */ new WeakMap()
const bind = /* @__PURE__ */ Function.bind.bind(Function.bind)
const weakHas = /* @__PURE__ */ bind(Function.call, WeakMap.prototype.has)
const weakGet = /* @__PURE__ */ bind(Function.call, WeakMap.prototype.get)
const weakSet = /* @__PURE__ */ bind(Function.call, WeakMap.prototype.set)
const mapHas = /* @__PURE__ */ bind(Function.call, Map.prototype.has)
const mapGet = /* @__PURE__ */ bind(Function.call, Map.prototype.get)
const mapSet = /* @__PURE__ */ bind(Function.call, Map.prototype.set)
const EnumIteratorPrototype = /* @__PURE__ */ (() => {
    const IteratorPrototype = getPrototypeOf(getPrototypeOf([].keys()))
    const EnumIteratorPrototype = objectCreate(IteratorPrototype)

    defineProperty(EnumIteratorPrototype, symbolToStringTag, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: "Enum Iterator",
    })

    installProperties(EnumIteratorPrototype, false, {
        next() {
            const data = weakGet(iteratorData, this)

            if (data == null) {
                throw new TypeError("`this` must be an enum iterator object!")
            }

            let done = false
            let value

            if (data.index === data.end) {
                done = true
                data.slot1 = data.slot2 = void 0
            } else {
                switch (data.type) {
                case 0: value = data.slot2[data.slot1++]; break
                case 1: value = data.index; data.slot1++; break
                case 2: value = [data.slot2[data.slot1++], data.index]; break
                case 3: value = data.slot1[data.index]; break

                case 4:
                    value = [data.slot1[data.index], data.slot2[data.index]]
                    break

                default: throw new Error("impossible")
                }
                data.index++
            }

            return {done, value}
        },
    })

    return EnumIteratorPrototype
})()

// eslint-disable-next-line max-params
function createIterator(type, index, end, slot1, slot2) {
    const iter = objectCreate(EnumIteratorPrototype)

    weakSet(iteratorData, iter, {type, index: 0, end, slot1, slot2})
    return iter
}

function installProperties(object, keys, methods) {
    for (let i = 0; i < keys.length; i++) {
        const desc = getOwnPropertyDescriptor(methods, keys[i])

        desc.enumerable = false
        defineProperty(object, keys[i], desc)
    }
}

function compare(a, b) {
    return Math.max(-1, Math.min(1, a - b | 0))
}

const builtinProperties = [
    "name", "prototype", "getKey", "compare", "keys", "values", "entries",
    symbolHasInstance, symbolIterator, symbolToStringTag,
]

// For most enums
function initEnum(name, keys, values) {
    const object = objectCreate(null)
    const keyMap = new Map1()
    const valueMap = new Map1()
    const methods = {
        [symbolToStringTag]: "Enum",
        [symbolIterator]: void 0,
        name,

        getKey(value) {
            return mapGet(keyMap, value)
        },

        [symbolHasInstance](value) {
            return mapHas(valueMap, value)
        },

        compare(a, b) {
            const indexA = mapGet(keyMap, a)
            const indexB = mapGet(keyMap, b)

            if (indexA != null && indexA != null) return compare(indexA, indexB)
            throw new Error("Both arguments must be members of this enum!")
        },

        keys() { return createIterator(3, 0, keys.length, keys, void 0) },
        values() { return createIterator(3, 0, keys.length, values, void 0) },
        entries() { return createIterator(4, 0, keys.length, keys, values) },
    }

    methods[symbolIterator] = methods.keys
    installProperties(object, builtinProperties, methods)

    for (let i = 0; i < keys.length; i++) {
        mapSet(keyMap, values[i], i)
        mapSet(valueMap, values[i], keys[i])
        object[keys[i]] = values[i]
    }

    return freeze(object)
}

// For simple string enums
function initStringEnum(name, keys) {
    const object = objectCreate(null)
    const keyMap = new Map1()
    const methods = {
        [symbolToStringTag]: "Enum",
        [symbolIterator]: void 0,
        name,

        getKey(value) {
            return mapHas(keyMap, value) ? value : void 0
        },

        [symbolHasInstance](value) {
            return mapHas(keyMap, value)
        },

        compare(a, b) {
            const indexA = mapGet(keyMap, a)
            const indexB = mapGet(keyMap, b)

            if (indexA != null && indexA != null) return compare(indexA, indexB)
            throw new Error("Both arguments must be members of this enum!")
        },

        keys() { return createIterator(3, 0, keys.length, keys, void 0) },
        values() { return createIterator(3, 0, keys.length, keys, void 0) },
        entries() { return createIterator(4, 0, keys.length, keys, keys) },
    }

    methods[symbolIterator] = methods.keys
    installProperties(object, builtinProperties, methods)

    for (let i = 0; i < keys.length; i++) {
        mapSet(keyMap, keys[i], i)
        object[keys[i]] = keys[i]
    }

    return freeze(object)
}

// For simple number enums
function initNumberEnum(name, keys, offset) {
    offset |= 0
    const length = keys.length | 0
    const end = length + offset | 0
    const object = objectCreate(null)
    const methods = {
        [symbolToStringTag]: "Enum",
        [symbolIterator]: void 0,
        name,

        getKey(value) {
            if (typeof value === "number") {
                const index = Math.abs(value | 0)

                if (value === index && index < end) return keys[index - offset]
            }

            return void 0
        },

        [symbolHasInstance](value) {
            if (typeof value !== "number") return false
            const index = Math.abs(value | 0)

            return value === index && index < end
        },

        compare(a, b) {
            if (typeof a === "number" && typeof b === "number") {
                const intA = Math.abs(a | 0)
                const intB = Math.abs(b | 0)

                if (a === intA && b === intB && Math.max(intA, intB) < end) {
                    return compare(intA, intB)
                }
            }

            throw new Error("Both arguments must be members of this enum!")
        },

        keys() { return createIterator(0, offset, end, 0, keys) },
        values() { return createIterator(1, offset, end, 0, void 0) },
        entries() { return createIterator(2, offset, end, 0, keys) },
    }

    methods[symbolIterator] = methods.keys
    installProperties(object, builtinProperties, methods)

    for (let i = 0; i < keys.length; i++) object[keys[i]] = i
    return freeze(object)
}

// For object enums
const objectValueMap = /* @__PURE__ */ new WeakMap()
const objectKeyMap = /* @__PURE__ */ new WeakMap()
const objectOwnerMap = /* @__PURE__ */ new WeakMap()
const EnumVariantPrototype = /* @__PURE__ */ (() => {
    const EnumVariantPrototype = objectCreate(null)
    const desc = {
        configurable: false,
        enumerable: false,
        writable: false,
        value: "Enum Variant",
    }

    installProperties(EnumVariantPrototype, [
        "type", "name", "parentEnum", "value",
    ], {
        get type() { return this },
        get name() {
            const key = weakGet(objectKeyMap, this)

            if (key == null) {
                throw new TypeError("`this` is not an enum variant!")
            }

            return key
        },
        get parentEnum() {
            const parent = weakGet(objectOwnerMap, this)

            if (parent == null) {
                throw new TypeError("`this` is not an enum variant!")
            }

            if (isExtensible(parent)) {
                throw new ReferenceError("Enum not initialized yet!")
            }

            return parent
        },
        get value() {
            if (!weakHas(objectValueMap, this)) {
                throw new TypeError("`this` is not an enum variant!")
            }

            return weakGet(objectValueMap, this)
        },
    })

    defineProperty(EnumVariantPrototype, symbolToStringTag, desc)
    desc.value = getOwnPropertyDescriptor(EnumVariantPrototype, "value").get
    defineProperty(EnumVariantPrototype, "toString", desc)
    defineProperty(EnumVariantPrototype, "valueOf", desc)
    defineProperty(EnumVariantPrototype, "toJSON", desc)
    return freeze(EnumVariantPrototype)
})()

function setValue(key, value) {
    weakSet(objectValueMap, key, value)
}

function isObject(value) {
    return value != null && typeof value === "object"
}

function initObjectEnum(name, initValues, keys) {
    // Hack to avoid a visible `Array.prototype[0]` setter check while not
    // having to use `Object.defineProperty` and its heavy descriptor set.
    const values = objectKeys(keys)
    const object = objectCreate(null)
    const indexMap = /* @__PURE__ */ new WeakMap()
    const methods = {
        [symbolToStringTag]: "Enum",
        [symbolIterator]: void 0,
        name,

        getKey(value) {
            return isObject(value) && weakHas(indexMap, value)
                ? value.name
                : void 0
        },

        [symbolHasInstance](value) {
            return isObject(value) && weakHas(indexMap, value)
        },

        compare(a, b) {
            if (isObject(a) && isObject(b)) {
                const indexA = weakGet(indexMap, a)
                const indexB = weakGet(indexMap, b)

                if (indexA != null && indexA != null) {
                    return compare(indexA, indexB)
                }
            }

            throw new Error("Both arguments must be members of this enum!")
        },

        keys() { return createIterator(3, 0, keys.length, keys, void 0) },
        values() { return createIterator(3, 0, keys.length, values, void 0) },
        entries() { return createIterator(4, 0, keys.length, keys, values) },
    }

    methods[symbolIterator] = methods.keys
    installProperties(object, builtinProperties, methods)

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const variant = freeze(objectCreate(EnumVariantPrototype))

        weakSet(indexMap, variant, i)
        weakSet(objectKeyMap, variant, key)
        weakSet(objectOwnerMap, variant, object)
        if (initValues) weakSet(objectValueMap, variant, key)
        values[i] = variant
        object[key] = variant
    }

    return freeze(object)
}
