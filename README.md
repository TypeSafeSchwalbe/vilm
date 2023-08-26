# Vilm
A simple and consistent programming language, but not to a point where it's annoying.

```
use data (list:push)

func fib(n) (
    var r ()
    var a 0
    var b 1
    for i range 0 n (
        var c {a + b}
        list:push r c
        set a b
        set b c
    )
    return r
)

display fib 10
```

### Using in the browser

To use Vilm in the browser, simply import `vilm.js` into your web page. In another script, you can then create a new instance of Vilm and tell it to execute a list of files:
```js
const vilm = new Vilm();
vilm.eval(`
    display "Hello, world!"
`, "test.vl");
vilm.evalFiles("foo.vl", "bar.vl");
```

### Using with Node.js

To use Vilm with node, simply `require("vilm.js")`, which will result in the `Vilm`-class being returned, which can then simply be saved in a constant:
```js
const Vilm = require("vilm.js");
const vilm = new Vilm();
vilm.eval(`
    display "Hello, world!"
`, "test.vl");
```

# Documentation and Playground

Documentation and a browser playground is available at [https://vilmlang.netlify.app/](https://vilmlang.netlify.app/).
