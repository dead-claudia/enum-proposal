# A proper enum proposal for JS

TL;DR: If you just want to get straight to the proposal and get a gist, [read this section](#proposal).

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
- Enum tables exist for remapping an enum variant to related data, in a way that is decoupled from the variant or enum itself.
- Enums consist of their variants and two tables: their keys and their values.
- Several helper methods exist on enums to make it easier for them to remap integers, strings, and symbols to their enum variants.

Apologies for the length. It's simpler than it looks - I just have a lot of low-level concerns about the implementation I wanted sorted out early. (It's why many enum proposals opt for numeric variants.)

### Syntax

#### Enum declarations

The basic syntax for enum declarations are this:

```js
// Normal enum. Doesn't support custom values or anything special.
enum Foo { FOO, BAR }
```

Note that it is an early error to specify a variant whose name collides with another variant, and it's an early error to specify a variant whose name collides with an enum's magic methods/properties (like `name` or `compare`).

This is what you want 99% of the time with an enum: a collection of values. Nothing special or fancy, just a simple enum.

#### Enum expressions

There are also enum expressions, which are much like enum declarations, but are meant for things like assigning to a property. The syntax is mostly the same, it's just the semantics that differ. For example:

```js
// Anonymous enum expression.
Foo.Bar = enum {
    // ...
}

// Named enum expression.
Foo.Bar = enum Bar {
    // ...
}
```

#### Value enums

The basic syntax for value enums are this:

```js
// `SomeType` here can be any object/function/whatever that has a
// `Symbol.toVariant` method. It's used to transform variants' values as well as
// optionally check them.
enum Foo: SomeType {
    // Equivalent to `FOO = "FOO"` for `enum Foo: String`, `FOO = 0` for
    // `enum foo: Number`, or `FOO = Symbol("Foo.FOO")` for `enum foo: Symbol`.
    FOO,
    // Values may be specified, and the result of calling
    // `SomeType[Symbol.variant]` with it and the relevant context is used as
    // the return value for `value`, `toString`, `valueOf`, and `toJSON`.
    BAR = FOO.value.name + "bar",
}

// And yes, enum expressions *can* be value enums.
Foo.Bar = enum: SomeType {
    // ...
}
```

These allow validating and transforming the type as appropriate. Common implementations exist for `Object` (passes all through untouched, but infers symbols), `Symbol` (validates its entries are symbols), `Number` (coerces its values to numbers, and infers `prev + 1`), and a few other globals, but custom ones are pretty easy to write. For example, if you wanted an enum of offsets, you could define an enum like this (pulled from [here](https://github.com/isiahmeadows/clean-match/blob/master/clean-match.js#L144-L149) and [here](https://github.com/isiahmeadows/enigma/blob/master/src/common.ts#L5-L21)):

```js
const Flags = {
    [Symbol.toVariant](value, context) {
        if (context == null || !context.infer) return value | 0
        const prev = context.prev | 0
        // Round to next power of two.
        const result = 1 << 32 - Math.clz32(prev)
        if (result === 1 && prev !== 0) throw new TypeError("Too many flags!")
        return result
    }
}

enum MatchContext: Flags { Strict, Initial, SameProto }

enum ParseContext: Flags {
    Empty = 0,

    OptionsNext,
    OptionsRanges,
    OptionsJSX,
    OptionsRaw,

    Strict,
    Module,

    ExpressionStart,
    TaggedTemplate,
}
```

During initialization, previously declared enum variants are available as constants within the scope of subsequent enum variant initializers, but later declared variants are behind a TDZ within that scope, but their bindings do not escape the enum's scope. This means, normally you'd get a `ReferenceError` if you were to evaluate one that's not ready yet, but if you were to do something like this, it would not error.

```js
let getSecond
enum Foo: String {
    First = (getSecond = () => Second, "First"),
    Second = "Second",
}

getSecond() === Foo.Second // true
```

The enum is itself declared as a `const`, guarded via TDZ, and is not defined until after all its variants are defined.

#### Enum tables

There are also enum tables. This is how you get mappings from enums to relevant values.

```js
// Declaration
enum table Bar for Foo {
    // Equivalent to FOO = "foo"
    FOO = 1,
    // Subsequent values may depend on previous values.
    BAR = Bar.get(FOO) + 2,
}

// Anonymous expression
Foo.Bar = enum table for Foo {
    // ...
}

// Named expression
Foo.Bar = enum table Bar for Foo {
    // ...
}

// And yes, enum tables can be transformed
```

The separation exists for data-driven reasons - it enables and encourages you to not couple your variant data to their tables, but instead you can add them free-form independently of the type. It doesn't have obvious utility in highly object-oriented code, but for many domains like with parsers and protocol parsing, this is often useful.

### High-level semantics

I don't currently have a polyfill/runtime ready, but it's definitely on my TODO list.

#### Well known symbols

There is a new well-known symbol \@\@toVariant, for coercing a value to an enum variant. It's called with the value (or `undefined` if it doesn't exist) and a context parameter, either an `{enum, key, index, infer}` object on initialization or `undefined` on lookup (i.e. with `Enum.fromValue`).

Here are some builtin implementations for this well-known symbol:

```js
Object[Symbol.toVariant] = (value, context) => {
    return _inferVariantSymbol(value, context, false)
}

Symbol[Symbol.toVariant] = (value, context) => {
    return _inferVariantSymbol(value, context, true)
}

String[Symbol.toVariant] = (value, context) => {
    return `${context != null && context.infer ? context.key : value}`
}

Number[Symbol.toVariant] = (value, context) => {
    if (context != null && context.infer) {
        value = context.prev
        return value == null ? 0 : value + 1
    }
    return +value
}

BigInt[Symbol.toVariant] = (value, context) => {
    if (context != null && context.infer) {
        value = context.prev
        return value == null ? 0n : value + 1n
    }
    return BigInt(value)
}

Function.prototype[Symbol.toVariant] = function (value, context) {
    if (context != null && context.infer || !(value instanceof this)) {
        // The side effects within `_inferName` and `this.name` don't really
        // exist
        throw new TypeError(
            `Expected ${_inferName(context)} to be an instance of ${this.name}`
        )
    }
    return value
}

// Private helper functions.
function _inferName(context) {
    return context != null
        ? `${context.enum.name || '<anonymous>'}.${context.key}`
        : "`value`"
}

function _inferVariantSymbol(value, context, checkSymbol) {
    if (context != null && context.infer) return Symbol(_inferName(context))
    if (checkSymbol && typeof value !== "symbol") {
        // The side effects within `_inferName` don't really exist
        throw new TypeError(`Expected ${_inferName(context)} to be a symbol`)
    }
    return value
}
```

#### Enum objects

Enum objects are frozen objects that inherit from `null` with the following non-enumerable properties:

- `Enum.variantCount` - This is the number of variants in the enum.
- `Enum.compare(a, b)` - Compare two enum variants by index, and return 1 if greater, 0 if equal, and -1 if lesser. This is a closure for convenience (think: sorting) and to allow a few early optimizations with it.
- `Enum.fromIndex(value)` - Convert a raw index to an enum instance. This is a closure for convenience (for functional people) and to allow a few early optimizations with it.
- `Enum.fromValue(value)` - Convert a raw value to an enum instance. This is a closure for convenience (for functional people) and to allow a few early optimizations with it. This is only present on value enums.
- `Enum.name` - This is a reference to the enum's name, or the empty string if it's anonymous.

Enum objects also carry their variants as enumerable properties. They are the only enumerable properties of enums, so you can get a list of enum keys simply by using `Object.keys(Enum)`, enum variants by `Object.values(Enum)`, or pairs with both via `Object.entries(Enum)`.

#### Enum variants

Enum variants are effectively frozen objects that inherit from `null` (through an intermediate frozen %EnumVariantPrototype%), with the following inherited methods/getters:

- `variant.name` - This returns the variant's declared name.
- `variant.enum` - This returns the variant's parent enum.
- `variant.index` - This returns the variant's index, in case that's ever relevant.
- `variant.value` - This returns the variant's value, or throws a `TypeError` if the variant's parent enum has no values.
- `variant.valueOf` - This returns the variant's value, or the variant's index if the variant's parent enum has no values.
- `variant.toString` - Alias for `variant.valueOf`.
- `variant.toJSON` - Alias for `variant.valueOf`.

The enum value is determined as follows:

- If no value is given, the name itself is used as the value, as a string.
- If an explicit value is given, it's kept in raw form.

For a concrete example:

```js
const baz = {}

enum Foo: Object {
    FOO,
    BAR = 1,
    BAZ = baz,
}

assert(Foo.FOO.value === "FOO")
assert(Foo.BAR.value === 1)
assert(Foo.BAZ.value === baz)
```

#### Enum tables

Enum tables are frozen objects that inherit from `null` (through an intermediate frozen %EnumTablePrototype%), with the following inherited methods/getters:

- `Table.name` - This returns the table's declared name.
- `Table.enum` - This returns the table's parent enum.
- `Table.has(variant)` - Return `true` if the variant has the corresponding value.
- `Table.get(variant)` - Get the corresponding value for this variant, or throw a `ReferenceError` if it doesn't exist or hasn't been set yet.
- `Table.keys()` - Return an iterator for the variants in this enum.
- `Table.values()` - Return an iterator for the values in this enum.
- `Table.entries()` - Return an iterator for the variants and values zipped in pairs in this enum.
- `Table[Symbol.iterator]` - Alias for %EnumTablePrototype%.entries.

During table creation, all names are checked to be a subset of or equal to the enum's names before creating them. Also, for `.get` and `.has`, it is a `TypeError` to specify anything not an enum variant within the table.

Each method forms a closure over the table for convenience (fewer `this` problems) and for easier optimization (you can specialize earlier).

### Pseudo-spec

I wrote some spec text because I want to make sure the low-level representation is still fast, and so I had to have an idea how it'd be spec'd and implemented. I'm designing for performance and future optimization opportunity, since I know many of these methods *will* be used in performance-sensitive contexts. Don't take that to mean this is mature at all - it's still something I've been iterating on for a while.

#### Well known symbols

There is a new well-known symbol \@\@toVariant, for coercing a value to an enum variant. Here are the default implementations for various builtins:

- Object\[\@\@toVariant](*value*, *context*):
    1. Return ? InferVariantSymbol(*context*, `false`).

- Symbol\[\@\@toVariant](*value*, *context*):
    1. Return ? InferVariantSymbol(*context*, `true`).

- String\[\@\@toVariant](*value*, *context*):
    1. If ? ValueIsInferred(*context*) is `true`, then
        1. Let *value* be ? Get(*context*, `"key"`).
    1. Return ? ToString(*value*).

- Number\[\@\@toVariant](*value*, *context*):
    1. If ? ValueIsInferred(*context*) is `true`, then
        1. Let *value* be ? Get(*context*, `"index"`).
        1. If *value* is `undefined` or `null`, return 0.
        1. Return *value* + 1.
    1. Return *value*.

- BigInt\[\@\@toVariant](*value*, *context*):
    1. If ? ValueIsInferred(*context*) is `true`, then
        1. Let *value* be ? Get(*context*, `"index"`).
        1. If *value* is `undefined` or `null`, return 0n.
        1. Return ToBigInt(*value*) + 1n.
    1. Return ToBigInt(*value*).

- Function.prototype\[\@\@toVariant](*value*, *context*):
    1. If ? ValueIsInferred(*context*) is `true`, then throw a `TypeError` exception.
    1. Let *F* be `this` value.
    1. If ? InstanceofOperator(*value*, *F*) is `false`, throw a `TypeError` exception.
    1. Return *value*.

Abstract Operation: ValueIsInferred(*context*)

1. If *context* is `undefined` or `null`, return `false`.
1. Return ? ToBoolean(? Get(*context*, `"infer"`))

Abstract Operation: InferVariantSymbol(*context*, *checkSymbol*)

1. If ? ValueIsInferred(*context*) is `false`, then
    1. If *checkSymbol* is `true` and Type(*value*) is not Symbol, throw a `TypeError` exception.
    1. Return *value*.
1. Let *name* be ? Get(*E*, `"name"`).
1. If *name* is the empty String, let *name* be the String value `"<anonymous>"`.
1. Let *key* be ? ToString(? Get(*context*, `"key"`)).
1. Let *value* be the string-concatenation of *name*, `"."`, and *key*.
1. Return ! Call(%Symbol%, `undefined`, « *value* »).

#### Enum objects

Enum variants are frozen ordinary objects with a two internal slots:

- [[EnumValueType]]: the enum's type, either `undefined` or an object implementing \@\@toVariant.
- [[EnumVariants]]: the enum's variants.

The former is not required to spec (this can be computed via `Object.values(enumObject)`), but it makes certain algorithms more obvious.

> Note: an implementation might choose to make enum variants allocated in one contiguous data block, where the list of variants is appended directly after the rest of the static members and object properties, much like how C's flexible array members work.
>
> Note: [[EnumValueType]] is never accessed after initialization on enum objects without a `"fromValue"` method. An implementation might choose to elide it, but keep in mind it would complicate many of the other optimizations in notes like these, such as that in enum `compare` methods.

Abstract Operation: CreateSimpleEnum(*name*, *keys*)

1. Let *variantCount* be the number of items in *keys*.
1. Assert: the number of items in *values* is also *variantCount*.
1. Let *E* be ObjectCreate(`null`, « [[EnumVariants]] »).
1. Let *compare* be CreateBuiltinFunction(steps for an enum `compare` function, « [[Enum]] »).
1. Let *fromValue* be CreateBuiltinFunction(steps for an enum `fromValue` function, « [[Enum]] »).
1. Let *hasInstance* be CreateBuiltinFunction(steps for an enum \@\@hasInstance function, « [[Enum]] »).
1. Set *compare*.[[Enum]] to *E*.
1. Set *hasInstance*.[[Enum]] to *E*.
1. Set *E*.[[EnumVariants]] to an empty list.
1. Set *E*.[[EnumValueType]] to `undefined`.
1. Perform ! CreateMethodProperty(*E*, `"name"`, *name*).
1. Perform ! CreateMethodProperty(*E*, `"variantCount"`, *variantCount*).
1. Perform ! CreateMethodProperty(*E*, `"compare"`, *compare*).
1. Perform ! CreateMethodProperty(*E*, `"fromIndex"`, *fromIndex*).
1. Perform ! CreateMethodProperty(*E*, \@\@hasInstance, *hasInstance*).
1. Perform ! CreateMethodProperty(*E*, \@\@toStringTag, `"Enum"`).
1. Let *index* be 0.
1. For each *key* in *keys*,
    1. Let *V* be CreateEnumVariant(*E*, *index*, *keys*[*index*]).
    1. Append *V* to *E*.[[EnumVariants]].
    1. Perform ! CreateDataProperty(*E*, *keys*[*index*], *V*).
    1. Increment *V* by 1.
1. Let *status* be ! SetIntegrityLevel(*E*, `"frozen"`).
1. Assert: *status* is `true`.
1. Return *E*.

Value Enum Factory records are used to control the creation of value enums. The schema name used within this specification to tag literal descriptions of Value Enum Factory records is "ValueEnumFactory". They contain the following fields:

- [[EnumObject]]: A reference to the in-progress enum object.
- [[EnumIndex]]: A reference to the enum's index.
- [[EnumPrevValue]]: A reference to the last assigned enum value, or `undefined` if none was assigned yet.

Abstract Operation: CreateValueEnumFactory(*name*, *type*, *variantCount*)

1. Assert: Type(*name*) is String.
1. If Type(*type*) is not Object, throw a new `TypeError` exception.
1. Let *compare* be CreateBuiltinFunction(steps for an enum `compare` function, « [[Enum]] »).
1. Let *fromIndex* be CreateBuiltinFunction(steps for an enum `fromIndex` function, « [[Enum]] »).
1. Let *fromValue* be CreateBuiltinFunction(steps for an enum `fromValue` function, « [[Enum]] »).
1. Let *hasInstance* be CreateBuiltinFunction(steps for an enum \@\@hasInstance function, « [[Enum]] »).
1. Let *E* be ObjectCreate(`null`, « [[EnumVariants]] »).
1. Set *compare*.[[Enum]] to *E*.
1. Set *E*.[[EnumVariants]] to an empty list.
1. Set *E*.[[EnumValueType]] to *type*.
1. Perform ! CreateMethodProperty(*E*, `"name"`, *name*).
1. Perform ! CreateMethodProperty(*E*, `"variantCount"`, *variantCount*).
1. Perform ! CreateMethodProperty(*E*, `"compare"`, *compare*).
1. Perform ! CreateMethodProperty(*E*, `"fromIndex"`, *fromIndex*).
1. Perform ! CreateMethodProperty(*E*, `"fromValue"`, *fromValue*).
1. Perform ! CreateMethodProperty(*E*, \@\@hasInstance, *hasInstance*).
1. Perform ! CreateMethodProperty(*E*, \@\@toStringTag, `"Enum"`).
1. Return ValueEnumFactory { [[EnumObject]]: *E*, [[EnumIndex]]: 0, [[EnumPrevValue]]: `undefined` }.

Abstract Operation: AddValueEnumKey(*F*, *key* [ , *value* ])

1. Assert: *F* has all the fields of a Value Enum Factory record.
1. Let *E* be *F*.[[EnumObject]].
1. Let *index* be *F*.[[EnumIndex]].
1. Let *infer* be `false`.
1. If *value* is not present, then
    1. Let *infer* be `true`.
    1. Let *value* be `undefined`.
1. Let *realValue* be ? CoerceEnumValue(*F*, *key*, *value*, *infer*).
1. Set *F*.[[EnumPrevValue]] to *realValue*.
1. Let *V* be CreateEnumVariant(*E*, *index*, *key*, *value*).
1. Append *V* to *E*.[[EnumVariants]].
1. Set *F*.[[EnumIndex]] to *index* + 1.
1. Perform ! CreateDataProperty(*E*, *key*, *V*).

Abstract Operation: FinishValueEnum(*F*)

1. Assert: *F* has all the fields of a Value Enum Factory record.
1. Let *E* be *F*.[[EnumObject]].
1. Let *status* be ! SetIntegrityLevel(*E*, `"frozen"`).
1. Assert: *status* is `true`.
1. Return *E*.

> Note: an implementation might choose to omit the type field for non-value enums.
>
> Note: an implementation might choose to make enums allocated in one contiguous data block, where the list of variants is appended directly after the rest of the static members and object properties, much like how C's flexible array members work.

Abstract Operation: CoerceEnumValue(*F*, *key*, *value*, *infer*)

1. Assert: *F* has all the fields of a Value Enum Factory record.
1. Let *E* be *F*.[[EnumObject]].
1. Let *prev* be *F*.[[EnumPrevValue]].
1. Let *type* be *E*.[[EnumValueType]].
1. Assert: Type(*type*) is Object.
1. Let *context* be ObjectCreate(`null`).
1. Perform ! CreateDataProperty(*context*, `"enum"`, *E*).
1. Perform ! CreateDataProperty(*context*, `"key"`, *key*).
1. Perform ! CreateDataProperty(*context*, `"prev"`, *prev*).
1. Perform ! CreateDataProperty(*context*, `"infer"`, *infer*).
1. Return ? Invoke(*type*, \@\@toVariant, « *value*, *context* »).

> Note: this is basically the following ECMAScript code:
> 
> ```js
> function CoerceEnumValue(F, key, value, infer) {
>     const E = F.EnumObject
>     const prev = F.EnumPrevValue
>     const type = F.EnumValueType
>     const context = {enum: E, key, prev, infer}
>     return type[Symbol.toVariant](value, context)
> }
> ```

Abstract Operation: ResolveEnumValue(*E*, *value*)

1. Assert: *E* has all the fields of an enum object.
1. Let *type* be *E*.[[EnumValueType]].
1. Assert: Type(*type*) is Object.
1. Return ? Invoke(*type*, \@\@toVariant, « *value*, `undefined` »).

Enum `compare` functions are builtin functions of length 2 with an internal slot [[Enum]] and their name set to `"compare"`. When an enum `compare` function *F* is called with arguments *a* and *b*, it performs the following steps:

1. If *a* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
1. If *b* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
1. Let *indexA* be none.
1. Let *indexB* be none.
1. Let *i* be 0.
1. For each *item* in *F*.[[Enum]].[[EnumVariants]]:
    1. If *indexA* is not none and *item* and *a* refer to the same object, set *indexA* to *i*.
    1. If *indexB* is not none and *item* and *b* refer to the same object, set *indexB* to *i*.
    1. Increment *i* by 1.
1. If *indexA* is none, throw a `TypeError` exception.
1. If *indexB* is none, throw a `TypeError` exception.
1. If *indexA* < *indexB*, return -1.
1. If *indexA* = *indexB*, return 0.
1. If *indexA* > *indexB*, return 1.

> Note: if an implementation chooses to allocate the variants as one contiguous data block right after the enum itself, it could choose to do the above this way instead:
>
> 1. Let *E* be *F*.[[Enum]].
> 1. If either *a* or *b* is not an object pointer, throw a `TypeError` exception.
> 1. Let *start* be *E*'s byte address + the size of the statically known items in enums in bytes.
> 1. Let *end* be *E*'s byte address + the size of the statically known items in enums in bytes + the number of variants in *E* * the the size of an enum variant in bytes.
> 1. If either *a* or *b* are not within the range [*start*, *end*), throw a `TypeError` exception.
> 1. Otherwise, return *a* - *b* clamped to the range [-1, 1].
>
> Conveniently, this requires minimal type checking for *a* or *b*, and where *E* is bound, it can assume its type. The range check implicitly accounts for things like pointers of other types, without having to explicitly code for it, since enum variants are limited to only a certain range.
>
> An implementation might also choose to compile and specialize this early, since the enum's address and length is constant and known before it's exposed to ECMAScript code.

> Note: value enums are constructed similarly.
>
> Note: an implementation might choose to make enums allocated in one contiguous data block, where the list of variants is appended directly after the rest of the static members and object properties, much like how C's flexible array members work.

Enum `fromIndex` functions are builtin functions of length 1 with an internal slot [[Enum]] and their name set to `"fromIndex"`. When an enum `fromIndex` function *F* is called with argument *index*, it performs the following steps:

1. Let *indexValue* be ? ToLength(*index*).
1. Let *variants* be *F*.[[Enum]].[[EnumVariants]].
1. Let *variantCount* be the number of items in *variants*.
1. If *indexValue* < *variantCount*, return *variants*[*indexValue*].
1. Return `undefined`.

> Note: if an implementation chooses to allocate the variants as one contiguous data block right after the enum itself, it could choose to do the above this way instead:
>
> 1. Let *E* be *F*.[[Enum]].
> 1. Let *result* be ? ToLength(*index*).
> 1. Let *start* be *E*'s byte address + the size of the statically known items in enums in bytes.
> 1. Let *end* be *E*'s byte address + the size of the statically known items in enums in bytes + the number of variants in *E* * the the size of an enum variant in bytes.
> 1. Add *start* to *result*.
> 1. If *result* ≥ *end*, let *result* be `undefined`.
> 1. Return *result*.
>
> An implementation might also choose to compile and specialize this early, since the enum's address and length is constant and known before it's exposed to ECMAScript code.

Enum `fromValue` functions are builtin functions of length 1 with an internal slot [[Enum]] and their name set to `"fromValue"`. When an enum `fromValue` function *F* is called with argument *index*, it performs the following steps:

1. Let *E* be *F*.[[Enum]].
1. Let *realValue* be ? ResolveEnumValue(*E*, *value*).
1. For each *item* in *E*.[[EnumVariants]]:
    1. If SameValueZero(*item*.[[VariantValue]], *realValue*) is `true`, then
        1. Return *item*.
1. Return `undefined`.

Enum \@\@hasInstance functions are builtin functions of length 1 with an internal slot [[Enum]] and their name set to `"[Symbol.hasInstance]"`. When an enum \@\@hasInstance function *F* is called with argument *value*, it performs the following steps:

1. If *value* does not have all the internal slots of an enum variant object, return `false`.
1. If *value*.[[VariantEnum]] and *F*.[[Enum]] refer to the same object, return `true`.
1. Return `false`.

> Note: if an implementation chooses to allocate the variants as one contiguous data block right after the enum itself, it could choose to do the above this way instead:
>
> 1. Let *E* be *F*.[[Enum]].
> 1. If *value* is not an object pointer, return `false`.
> 1. Let *start* be *E*'s byte address + the size of the statically known items in enums in bytes.
> 1. Let *end* be *E*'s byte address + the size of the statically known items in enums in bytes + the number of variants in *E* * the the size of an enum variant in bytes.
> 1. Return `true` if *value* is within [*start*, *end*), `false` otherwise.
>
> Conveniently, where *E* is bound, it can assume its type. The range check implicitly accounts for things like pointers of other types, without having to explicitly code for it, since enum variants are limited to only a certain range. Since the enum's address and length is constant and known before it's exposed to ECMAScript code, an implementation might choose to compile and specialize this early using an algorithm similar to the above one, precomputing the *start* and *end* for the range check and inlining them as constants.
>
> For V8 at least, it'd look something close to [this](https://godbolt.org/g/cft9wa) (where `ENUM_ADDR` is the enum's address, and `ENUM_VARIANT_COUNT` is the number of variants in the enum):
>
> ```cpp
> #define START (ENUM_ADDR + sizeof(JSEnumObject))
> #define END (START + ENUM_VARIANT_COUNT * sizeof(JSEnumVariantObject))
> 
> bool has_instance(Object* variant) {
>     uintptr_t ptr = (uintptr_t) variant;
>     return !variant->isSmi() & (ptr >= START) & (ptr < END);
> }
>
> // GCC compiles that pretty impressively for x86-64:
> // (Note: value = rdi, result = rax)
> //
> // mov rax, qword ptr [(-ENUM_ADDR - sizeof(JSEnumObject))]
> // add rax, rdi
> // cmp rax, (VARIANT_COUNT * sizeof(JSEnumVariantObject) - 1)
> // setbe al
> // and eax, edi
> //
> // GCC on ARM is pretty similar:
> // (Note: value = r1, result = r0)
> //
> // ldr r1, =(-ENUM_ADDR - sizeof(JSEnumObject))
> // add r1, r0, r1
> // cmp r1, (ENUM_VARIANT_COUNT * sizeof(JSEnumVariantObject) - 1)
> // movhi r0, #0
> // andls r0, r0, #1
> ```
>
> For SpiderMonkey, it'd look similar, but it would do `variant->isObject()` instead of `!variant->isSmi()`, and it'd be about twice the number of instructions.

#### Enum variants

Enum variants are frozen ordinary objects with their [[Prototype]] set to %EnumVariantPrototype% the following internal slots:

- [[VariantEnum]]: The enum itself.
- [[VariantIndex]]: The enum's index.
- [[VariantName]]: The enum variant's name.
- [[VariantValue]]: The enum variant's value.

Abstract Operation: CreateEnumVariant(*E*, *index*, *name* [ , *value* ])

1. If *value* is not present, let *value* be none.
1. Let *V* be ObjectCreate(%EnumVariantPrototype%, « [[VariantEnum]], [[VariantIndex]], [[VariantValue]] »).
1. Set *V*.[[VariantEnum]] to *E*.
1. Set *V*.[[VariantIndex]] to *index*.
1. Set *V*.[[VariantValue]] to *value*.
1. Return *V*.

> Note: an implementation might choose to create two separate variant types, one with values and one without. This could be done using the same variant data structure otherwise, and it simplifies a few optimizations with coercions.
>
> Note: an implementation might choose to allocate an enum's variants contiguously, rather than allocating each variant individually and separately.

Abstract Operation: LookupVariantValue(*V* [ , *default* ])

1. Let *table* be *V*.[[VariantEnum]].[[ValueTable]].
1. If Type(*table*) is Undefined,
    1. If *default* was passed, return *default*.
    1. Throw a `TypeError` exception.
1. Let *value* be EnumTableLookup(*table*, *V*).
1. Assert: *value* is not none.
1. Return *value*.

%EnumVariantPrototype% is an ordinary object with its [[Prototype]] set to `null`. %EnumVariantPrototype% has the following non-enumerable, non-configurable, non-writable methods:

- get %EnumVariantPrototype%.name:
    1. Let *V* be `this` value.
    1. If *V* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
    1. Return *V*.[[VariantName]].

- get %EnumVariantPrototype%.enum:
    1. Let *V* be `this` value.
    1. If *V* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
    1. Return *V*.[[VariantEnum]].

> Note: if an implementation chooses to allocate the variants as one contiguous data block right after the enum itself, a variant *v*'s enum could be computed via this algorithm:
> 1. Let *result* be *v* as a byte-aligned pointer.
> 1. Subtract from *result* *v*'s index * the size of a variant in bytes
> 1. Subtract from *result* the size of the statically known items in enums in bytes.
> 1. Return *result*.

- get %EnumVariantPrototype%.index:
    1. Let *V* be `this` value.
    1. If *V* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
    1. Return *V*.[[VariantIndex]].

- get %EnumVariantPrototype%.value:
    1. Let *V* be `this` value.
    1. If *V* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
    1. Let *value* be *V*.[[VariantValue]].
    1. If *value* is none, throw a `TypeError` exception.
    1. Return *value*.

- %EnumVariantPrototype%.valueOf():
    1. Let *V* be `this` value.
    1. If *V* does not have all the internal slots of an enum variant object, throw a `TypeError` exception.
    1. Let *value* be *V*.[[VariantValue]].
    1. If *value* is none, return *V*.[[VariantIndex]]).
    1. Return *value*.

- %EnumVariantPrototype%.toString: Alias for %EnumVariantPrototype%.valueOf.
- %EnumVariantPrototype%.toJSON: Alias for %EnumVariantPrototype%.valueOf.

- %EnumVariantPrototype%[\@\@toStringTag]: The String value `"Enum Variant"`.

#### Enum tables

Enum tables are ordinary objects with three internal slots, [[TableName]] for the table's name, [[TableEnum]] for the table's enum, and [[TableValues]] for the table's values. They are always frozen before exposed to ECMAScript code.

> Note: an implementation might choose to make enum tables allocated in one contiguous data block, where the list of values is appended directly after the rest of the static members and object properties, much like how C's flexible array members work.

Abstract Operation: CreateEnumTable(*name*, *E*)

1. If *E* does not have all of the internal slots of an enum object, throw a `TypeError`.
1. Let *variantCount* be the number of items in *E*.[[EnumVariants]].
1. Let *T* be ObjectCreate(%EnumTablePrototype%, « [[TableName]], [[TableEnum]], [[TableValues]] »).
1. Set *T*.[[TableName]] to *name*.
1. Set *T*.[[TableEnum]] to *E*.
1. Set *T*.[[TableValues]] to a list of *variantCount* nones.
1. Let *status* be ! SetIntegrityLevel(*T*, `"frozen"`).
1. Assert: *status* is `true`.
1. Return *T*.

Abstract Operation: SetEnumTableValue(*T*, *key*, *value*)

1. Assert: *T* has all the fields of a Value Enum Factory record.
1. Assert: *key* has all the internal slots of an enum variant object.
1. Let *tableEnum* be *T*.[[TableEnum]].
1. Let *keyEnum* be *key*.[[VariantEnum]].
1. Assert: *tableEnum* and *keyEnum* refer to the same object.
1. Let *keyIndex* be *key*.[[VariantIndex]].
1. Set *T*.\[[TableValues]][*index*] to *value*.

%EnumTableIteratorPrototype% is an ordinary object that inherits from %IteratorPrototype%. It has one method, `next`, which when called, performs the following steps:

1. Let *O* be `this` value.
1. If *O* does not have the internal slots of an enum table iterator object, throw a `TypeError` exception.
1. Let *type* be *O*.[[EnumTableIteratorKind]].
1. Assert: *type* is one of `"key"`, `"value"`, or `"key+value"`
1. Let *T* be *O*.[[IteratedTable]].
1. Let *index* be *O*.[[EnumTableIteratorNextIndex]].
1. Let *keys* be *T*.[[TableEnum]].[[EnumVariants]].
1. Let *values* be *T*.[[TableValues]].
1. Let *len* be the number of elements of *T*.[[TableValues]].
1. If *index* ≥ *len*, then return CreateIterResultObject(`undefined`, `true`).
1. Set *O*.[[EnumTableIteratorNextIndex]] to *index*+1.
1. If *type* is `"key"`,
    1. Let *result* be *keys*[*index*].
1. Else, if *type* is `"value"`,
    1. Let *result* be *values*[*index*].
1. Else, if *type* is `"key+value"`,
    1. Let *result* be CreateArrayFromList(« *keys*[*index*], *values*[*index*] »).
1. Return CreateIterResultObject(*result*, `false`).

> Note: if an implementation chooses to allocate the variants as one contiguous data block right after the enum itself, *key* could be computed from *T*.[[TableEnum]] via this algorithm, to avoid having to index the object's properties:
> 1. Let *E* be *T*.[[TableEnum]].
> 1. Let *v* be *E* as a byte-aligned pointer.
> 1. Add to *v* the size of the statically known items in enums in bytes.
> 1. Add to *v* *index* * the size of a variant in bytes
> 1. Return *v*.

Abstract Operation: CreateEnumTableIterator(*T*, *kind*):

1. Assert: *T* has all the internal slots of an enum table object.
1. Let *O* be ObjectCreate(%EnumTableIteratorPrototype%, « [[IteratedTable]], [[EnumTableIteratorKind]], [[EnumTableIteratorNextIndex]] »).
1. Set *O*.[[IteratedTable]] to *T*.
1. Set *O*.[[EnumTableIteratorKind]] to *kind*.
1. Set *O*.[[EnumTableIteratorNextIndex]] to 0.
1. Return *O*.

Abstract Operation: EnumTableLookup(*T*, *V*):

1. Assert: *T* has all the internal slots of an enum table object.
1. Assert: *V* has all the internal slots of an enum variant object.
1. Let *tableEnum* be *T*.[[TableEnum]].
1. Let *variantEnum* be *V*.[[VariantEnum]].
1. Assert: *tableEnum* and *variantEnum* refer to the same object.
1. Let *variants* be *tableEnum*.[[EnumVariants]].
1. Let *values* be *T*.[[TableValues]].
1. Let *index* be 0.
1. For each *item* in *variants* in List order, do
    1. If *V* and *item* refer to the same object, return *values*[*index*].
    1. Increment *index* by 1.
1. Return none.

> Note: if an implementation chooses to allocate the variants and values as one contiguous data block, it could choose to do the above this way instead:
>
> 1. Let *ref* be the variant's index * the size of a pointer.
> 1. Add to *ref* *T*'s pointer as a byte-aligned pointer.
> 1. Add to *ref* the size of a table's static portion. (Conveniently, `sizeof(...)` by spec ignores flexible array members when calculating, if this helps.)
> 1. Dereference *ref* and then return the result.

%EnumTablePrototype% is an ordinary object with its [[Prototype]] set to `null`. %EnumTablePrototype% has the following non-enumerable, non-configurable, non-writable methods:

- get %EnumTablePrototype%.name:
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. Return *T*.[[TableName]].

- get %EnumTablePrototype%.enum:
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. Return *T*.[[TableEnum]].

- %EnumTablePrototype%.has(*key*):
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. If *key* does not have all of the slots of an enum variant object, throw a `TypeError` exception.
    1. If *key*.[[VariantEnum]] and *T*.[[TableEnum]] do not refer to the same object, throw a `TypeError` exception.
    1. Let *result* be EnumTableLookup(*T*, *key*).
    1. If *result* is none, return `false`.
    1. Return `true`.

- %EnumTablePrototype%.get(*key*):
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. If *key* does not have all of the slots of an enum variant object, throw a `TypeError` exception.
    1. If *key*.[[VariantEnum]] and *T*.[[TableEnum]] do not refer to the same object, throw a `TypeError` exception.
    1. Let *result* be EnumTableLookup(*T*, *key*).
    1. If *result* is none, throw a `ReferenceError` exception.
    1. Return *result*.

- %EnumTablePrototype%.keys():
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. Return ! CreateEnumTableIterator(*T*, `"key"`).

- %EnumTablePrototype%.values():
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. Return ! CreateEnumTableIterator(*T*, `"value"`).

- %EnumTablePrototype%.entries():
    1. Let *T* be `this` value.
    1. If *T* does not have all the internal slots of an enum table object, throw a `TypeError` exception.
    1. Return ! CreateEnumTableIterator(*T*, `"key+value"`).

- %EnumTablePrototype%[\@\@iterator]: Alias for %EnumTablePrototype%.entries.

- %EnumTablePrototype%[\@\@toStringTag]: The String value `"Enum Table"`.

#### Implementation Tips

There are optimization opportunities here that can really help speed up the implementation quite a bit. The spec doesn't always make them clear, but optimizing these are pretty critical to making them viable in performance-critical code. I did take a few careful considerations to enable engines to propagate constants in certain places, but in general, engines should try to implement these as new semi-exotic objects rather than a normal object.

1. Enums, enum tables, and enum variants all have completely immutable prototype chains and are always frozen with pretty much everything write-once and, after initialization, fully immutable. This makes it far easier to specialize for their types.

1. Enum variants could be represented via pointers to their values within a contiguously allocated array. This enables several speed and size optimizations, provided you lay things out correctly. I left several concrete tips on how you could improve implementation performance throughout the pseudo-spec.

1. Enum variants are ordinary objects in the spec, but they should really be implemented as exotic objects. You can optimize for the fact they are always frozen, carry the same realm-specific prototype, 4 internal slots (one of which could be computed through pointer arithmetic), and never any own properties. You can also take advantage of the fact they can only exist as part of an enum, through allocating them differently than normal objects. (This was alluded to in the notes.)

## Future directions

This proposal was designed with a few possible extensions in mind:

### Enum spreading

This is for dynamic construction of enums.

The syntax is pretty simple, but it's restricted to value enums only:

```js
// Value enums only
enum Foo: String { ...Bar, BAZ }
```

The semantics are pretty obvious:

- New symbol \@\@toEnum, with no initial builtin implementations. (The default for iterables and enums handles 99.9% of cases.)
- The spread operand invokes \@\@toEnum with the relevant type (either `"object"`, `"string"`, `"number"`, or `"symbol"`) if it exists, and then merges the result into the in-progress enum according to its type:
    - Enums would be merged directly with appropriate coercions and/or type checking.
    - Iterables would be taken to assume (with type checking) it's an iterable of iterable/array-like pairs and added to the enum as key/value pairs, with appropriate coercions and/or type checking.
    - Objects would be added to the enum using the pairs from `Object.entries(object)` (implementation detail - it just uses the algorithm to create the list), with appropriate coercions and/or type checking.
- A runtime error would be thrown if a spread operand's key conflicts with a builtin enum key.
- The key list is resolved and deduplicated *before* it gets translated into an enum, so later keys/values can override previous keys/values.

I'd rather provide a minimal, purely syntactic means of doing this, instead of creating a whole new global for everything to complicate the picture further.

### Abstract Data Types

Yes, I'm popping this one early, because I know it'll be requested very quickly. I do understand the use of it - classes are nice when you're dealing with state, but when you're dealing primarily with structure, we need to be seeing less of [this](https://github.com/mishoo/UglifyJS2/blob/master/lib/ast.js#L129-L862) and we need to offer ways to allow engines to optimize polymorphic structures in high-performance situations without resorting to hacks like [this](https://github.com/infernojs/inferno/blob/master/packages/inferno/src/core/implementation.ts#L60-L89) or [this](https://github.com/MithrilJS/mithril.js/blob/next/render/vnode.js). And the best way to do it is to give them a hint on how they should lay out that structure without letting type maps get too much in the way.

This would involve a few things:

1. New syntax, of course. :slightly_smiling_face:

    ```js
    // Of course, you can still specify the type of the discriminant. The enum
    // itself and each variant is equipped with a `Symbol.hasInstance` to deal
    // with it.
    enum class Foo: SomeType {
        // Simple variants with inferred values
        simple(one, two, three),

        // Variants with explicit values.
        withDesc(one, two, three) = "desc",

        // Zero-argument singleton variants with inferred values.
        singletonVariant,

        // Zero-argument singleton variants with explicit values.
        singletonVariantWithDesc = "desc",

        // This is intentionally invalid. Don't use it.
        // singletonFactory(),

        // The enum itself can have static or prototype methods. Note that these
        // are disambiguated by the presence of a block start, rather than a
        // comma or equal sign. Enum variants can't have public instance fields
        // like what's proposed for normal classes, since instances are not
        // normal objects. (They *are* ordinary objects, but they're frozen.)
        instanceMethod() {
            // ...
        }

        static enumMethod() {
            // ...
        }
    }

    // You would construct these like so:
    const foo = Foo.Simple(1, 2, 3)
    const bar = Foo.WithDesc(1, 2, 3)
    const baz = Foo.SingletonVariant

    // If you want immutability:
    const enum class Foo {
        // ...
    }
    ```

1. Enum classes are not frozen. They are instead [immutable prototype exotic objects](https://tc39.github.io/ecma262/#sec-immutable-prototype-exotic-objects), with the normal builtin enum methods non-writable, non-configurable. Custom methods may be added at will, as long as they don't conflict with the builtin stuff.

1. Enum classes themselves have a few of the typical properties and methods of standard enums, but are not themselves enums. Here's what they have:

    - `Enum.parse(value)` - Convert a JSON-serialized record to an enum instance. Mostly the inverse of `Enum.prototype.toJSON`.
    - `Enum.name` - This is a reference to the enum class's name, or the empty string if it's anonymous.
    - `Enum.variants` - This is a reference to the enum for all the variant types. Each variant has the same name as their variant constructor, and their values correspond to the values of the enum class.
    - `Enum.constructors` - This is a table to remap enum variant types to their variant constructors. This is in part for convenience, but also in part to help implement `Enum.prototype.constructor` as a getter.
    - `Enum[Symbol.hasInstance]` - This is an alias of `Function.prototype[Symbol.hasInstance]`.
    - `Enum[Symbol.toVariant]` - This is an alias of `Function.prototype[Symbol.toVariant]`.

1. Enum class variant constructors are normal functions that return new enum class instances. No check is made to verify `new.target`, so it can be called or constructed. Each variant constructor also has an own `Variant.create({key: value, ...})` method to create a new instance from an object with named properties where missing properties are silently set to `undefined`, for readability and convenience. (Properties that the variant doesn't have are silently ignored.)

1. `Enum.prototype` itself is non-configurable, non-writable, non-enumerable, inherits from `null`, and is created from scratch for every enum class (as most of it is specific to the enum itself). There are a few utility properties and methods on it:

    - `instance.type` - Get the instance's variant type.
    - `instance.enum` - Get the instance's enum class.
    - `instance.constructor` - Get the instance's variant constructor. Note that this is a *getter*, not a data property.
    - `instance.update({key: value, ...})` - Return a shallow clone of this instance with the relevant keys set to those values. Properties that the variant doesn't have are silently ignored. This is only present on `const enum class`es, as it's only necessary there.
    - `instance.toJSON()` - Convert this object to a representation safe for `JSON.stringify`.
    - `instance[Symbol.iterator]()` - Iterate this enum's values.

1. Enum class instances are frozen objects that inherit from `Enum.prototype`, and the relevant names from each variant are exposed on the *prototype* via getters and setters, not the object itself. This allows the objects to remain monomorphic while retaining the ability to access their data by property name.

    - A `TypeError` is thrown if a property is accessed on an instance whose variant type lacks the property. This is checked in the getter
    - These would have two internal slots: one for the variant type and another for the value.
    - It's an early error if any member type is one of the pre-existing properties on `Enum.prototype`, and it's an early error to declare duplicate parameters.

I don't have exacts nailed down for this, but I can see the use of it.

If you want to see one form in action, here's Mithril's vnode structure rewritten to leverage this:

```js
enum class Vnode {
    // These extra properties are used internally for state.
    DOMSingle(dom, domSize, state, events, tag, key, attrs, text),
    DOMMulti(dom, domSize, state, events, tag, key, attrs, children),
    Component(dom, domSize, state, instance, tag, key, attrs, children),
    FragmentSimple(dom, domSize, state, children),
    FragmentAttrs(dom, domSize, state, key, attrs, children),
    Text(dom, text),
    Trust(dom, domSize, text),

    static hyperscriptSingle(tag, key, attrs, text) {
        return Vnode.DOMSingle.create({tag, key, attrs, text})
    }

    static hyperscriptMulti(tag, key, attrs, children) {
        return Vnode.DOMMulti.create({tag, key, attrs, children})
    }

    static component(tag, attrs, children) {
        return Vnode.Component.create({tag, key: attrs.key, attrs, children})
    }

    static text(text) {
        if (text == null) text = ""
        return Vnode.Text.create({text})
    }

    static trust(html) {
        if (html == null) html = ""
        return Vnode.Trust.create({html})
    }

    static normalize(node) {
        if (Array.isArray(node)) {
            return Vnode.FragmentSimple.create({
                children: Vnode.normalizeChildren(node),
            })
        } else if (node != null && typeof node !== "object") {
            return Vnode.Text({text: node === false ? "" : `${node}`})
        } else {
            return node
        }
    }

    static normalizeChildren(input) {
        const children = []
        for (let i = 0; i < input.length; i++) {
            children[i] = Vnode.normalize(input[i])
        }
        return children
    }
}
```

## Things I've considered, but rejected

- Flags enums. I know these are useful, and I use bit masks myself on occasion, but there's too much variation on how to handle these to make these worthwhile. I did explain how you could factor them in to an extent through a custom value enum type (the `Flags` enum type above), but in practice, most uses of flags enums are really just using the enum as a namespace for constants, not really using it as an *enumeration*. Bit masks are closer to miniature structs rather than enum variants, like a bunch of booleans packed with the occasional possible embedded enum variant. I could see, however, a standard library module justified for working with bit masks, complete with the above `Flags` enum type, but enums are just the wrong tool here for general use.
    - If the `Flags` enum type were to make it, I'd prefer it to be `Number.Flags` + `BigInt.Flags`, so it's clearly tied to the integer type. But that's as far as I feel anyone should go.
