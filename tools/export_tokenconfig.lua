
package.path = package.path .. ";luajson/?.lua"
local JSON = require"json"

local DEST_FOLDER = "/home/morr/foundry/foundrydata-dev/Data/beneostokens_data/"

local journalDB  ='../scripts/beneostokensconfig_original.json'
local fdb = io.open(journalDB)
local rawdata = fdb:read("*a")
fdb:close()

-- Load all actors
local actors= {}
local actorDB  ='../packs/beneostokens_TopDown.db.saved'
local fdb = io.open(actorDB)
local line = fdb:read()
while line do 
  local actor = JSON.decode( line )
  actors[#actors+1] = actor
  line = fdb:read()
end
fdb:close()

-- Load all journals
local journals = {}
local journalDB  ='../packs/beneostokens_journal.db.saved'
local fdb = io.open(journalDB)
local line = fdb:read()
while line do 
  local journal = JSON.decode( line )
  journals[#journals+1] = journal
  line = fdb:read()
end
fdb:close()

-- Decode the whole config
local json = JSON.decode( rawdata )

-- Parse json
for key, def in pairs(json) do -- key is the token data folder
  print("Parsink ", key)
  local id = string.sub(key, 1, 3)
  local cleankey = string.lower(key)
  local filename = DEST_FOLDER .. key .. "/tokenconfig_" .. cleankey .. ".json"
  
  local fpo = io.open(filename, "w+")
  fpo:write( JSON.encode( { [key] = def }) )
  fpo:write()
  print("    CONF", filename)

  for idx, actor in pairs(actors) do
    if actor.img and actor.img:match( key ) then
      print("    Actor WRITE", actor, actor.img, key)
      local filename = DEST_FOLDER .. key .. "/actor_" .. cleankey .. ".json" 
      local fpo = io.open(filename, "w+")
      fpo:write(JSON.encode( actor) )
      fpo:close()
    end
  end

  for idx, journal in pairs(journals) do
    if journal.content and journal.content:match( key ) then
      print("    Journal WRITE", journal, journal.img, key)
      local filename = DEST_FOLDER .. key .. "/journal_" .. cleankey .. ".json" 
      local fpo = io.open(filename, "w+")
      fpo:write(JSON.encode( journal) )
      fpo:close()
    end    
  end

end

