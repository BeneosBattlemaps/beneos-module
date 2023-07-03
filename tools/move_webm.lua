
local lfs = require"lfs"

local DEST_FOLDER = "/home/morr/foundry/foundrydata-dev/Data/beneostokens_data/"
local VIDEO_FOLDER = "/home/morr/Downloads/beneos/webm/"

for file in lfs.dir(VIDEO_FOLDER) do 
  local path = file:match("(%d+_[%w_-]+)%-preview")
  if path then 
    local cpfolder = DEST_FOLDER .. path
    local cmd = "cp " .. VIDEO_FOLDER .. file .. " " .. cpfolder .. "/."
    os.execute( cmd )
  end
end