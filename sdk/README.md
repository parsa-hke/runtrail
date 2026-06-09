# runtrail

Local-first experiment tracker for solo ML researchers.

See the [full documentation](https://github.com/runtrail/runtrail) for details.

```python
import runtrail

run = runtrail.init(config={"lr": 0.1})
for step in range(100):
    run.log({"loss": 1.0 - step * 0.01}, step=step)
run.finish()
```
