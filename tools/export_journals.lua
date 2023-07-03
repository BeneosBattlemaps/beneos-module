
package.path = package.path .. ";luajson/?.lua"
local JSON = require"json"

--local talent_db  = "../../WFRP4e-FoundryVTT/packs/talents.db"
local journalDB  ='../packs/beneostokens_journal.db.saved'
local fdb = io.open(journalDB)

local function trim1(s)
  return (s:gsub("^%s*(.-)%s*$", "%1"))
end

local line = fdb:read()
while line do 
  --print(line)
  local journal = JSON.decode( line )
  
  local filename = "journal_" .. string.gsub( string.lower(journal.name), " ", "_") .. ".json"
  
  local fpo = io.open(filename, "w+")
  fpo:write( JSON.encode( journal) )
  fpo:close()
  
  line = fdb:read()
end

fdb:close()

