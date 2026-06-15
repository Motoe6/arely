#!/usr/bin/env pwsh
$node = Get-Command node | Select-Object -ExpandProperty Source
& $node "$PSScriptRoot\dist\bin.js" $args
