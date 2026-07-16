if (Get-Command -Name Disable-AzContextAutosave -ErrorAction SilentlyContinue) {
	Disable-AzContextAutosave -Scope Process | Out-Null
}